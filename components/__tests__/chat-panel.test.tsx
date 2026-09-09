import React from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { deleteCookie, getCookie, setCookie } from '@/lib/utils/cookies'

import { ChatPanel } from '../chat-panel'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('../artifact/artifact-context', () => ({
  useArtifact: () => ({ close: vi.fn() })
}))

vi.mock('../action-buttons', () => ({
  ActionButtons: () => null
}))

vi.mock('../library/library-context', () => ({
  useLibrary: () => ({
    upsertCachedFile: vi.fn()
  })
}))

vi.mock('../library/library-picker-dialog', () => ({
  LibraryPickerDialog: () => null
}))

vi.mock('../message-navigation-dots', () => ({
  MessageNavigationDots: () => null
}))

vi.mock('../model-selector-client', () => ({
  ModelSelectorClient: () => null
}))

vi.mock('../uploaded-file-list', () => ({
  UploadedFileList: () => null
}))

vi.mock('../ui/icons', () => ({
  IconBlinkingLogo: () => <div data-testid="logo" />,
  IconLogoOutline: ({ className }: { className?: string }) => (
    <span className={className} data-testid="adaptive-icon" />
  )
}))

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteCookie('searchMode')
  })

  test('preserves and submits the initial query after resetting a stale adaptive cookie', async () => {
    const append = vi.fn()
    const onAdaptiveModeAuthRequired = vi.fn()
    setCookie('searchMode', 'adaptive')

    render(
      <ChatPanel
        chatId="chat-1"
        input=""
        handleInputChange={vi.fn()}
        handleSubmit={vi.fn()}
        status="ready"
        messages={[]}
        setMessages={vi.fn()}
        query="latest news"
        stop={vi.fn()}
        append={append}
        showScrollToBottomButton={false}
        scrollContainerRef={React.createRef<HTMLDivElement>()}
        uploadedFiles={[]}
        setUploadedFiles={vi.fn()}
        quotedContexts={[]}
        setQuotedContexts={vi.fn()}
        noteContexts={[]}
        setNoteContexts={vi.fn()}
        isGuest
        isCloudDeployment
        onAdaptiveModeAuthRequired={onAdaptiveModeAuthRequired}
      />
    )

    await waitFor(() => {
      expect(getCookie('searchMode')).toBe('quick')
    })
    await waitFor(() => {
      expect(append).toHaveBeenCalledWith({
        role: 'user',
        parts: [{ type: 'text', text: 'latest news' }]
      })
    })
    expect(onAdaptiveModeAuthRequired).not.toHaveBeenCalled()
  })
})

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}
) {
  return render(
    <ChatPanel
      chatId="chat-1"
      input=""
      handleInputChange={vi.fn()}
      handleSubmit={vi.fn()}
      status="ready"
      messages={[]}
      setMessages={vi.fn()}
      stop={vi.fn()}
      append={vi.fn()}
      showScrollToBottomButton={false}
      scrollContainerRef={React.createRef<HTMLDivElement>()}
      uploadedFiles={[]}
      setUploadedFiles={vi.fn()}
      quotedContexts={[]}
      setQuotedContexts={vi.fn()}
      noteContexts={[]}
      setNoteContexts={vi.fn()}
      {...overrides}
    />
  )
}

function pngFile(name = 'image.png') {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: 'image/png'
  })
}

function pasteFiles(target: HTMLElement, files: File[]) {
  fireEvent.paste(target, {
    clipboardData: { files, items: [], getData: () => '' }
  })
}

describe('ChatPanel paste', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('uploads a pasted image through the attach flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        file: {
          url: 'https://s3.example.test/image.png',
          filename: 'image.png',
          key: 'user/chats/chat-1/image.png',
          mediaType: 'image/png'
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const setUploadedFiles = vi.fn()
    renderPanel({ setUploadedFiles })

    pasteFiles(screen.getByPlaceholderText('Ask anything...'), [pngFile()])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/upload')
    const body = init.body as FormData
    expect((body.get('file') as File).name).toBe('image.png')
    expect(body.get('chatId')).toBe('chat-1')
    expect(setUploadedFiles).toHaveBeenCalled()
  })

  test('leaves non-image clipboard files alone', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    pasteFiles(screen.getByPlaceholderText('Ask anything...'), [
      new File(['hello'], 'notes.txt', { type: 'text/plain' })
    ])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not upload pasted images for guests', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPanel({ isGuest: true })

    pasteFiles(screen.getByPlaceholderText('Ask anything...'), [pngFile()])

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
