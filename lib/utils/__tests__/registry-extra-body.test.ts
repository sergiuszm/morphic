import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseExtraBody, withExtraBody } from '../registry'

describe('parseExtraBody', () => {
  it('returns undefined for unset or empty values', () => {
    expect(parseExtraBody(undefined)).toBeUndefined()
    expect(parseExtraBody('')).toBeUndefined()
  })

  it('returns undefined for invalid JSON and non-objects', () => {
    expect(parseExtraBody('not json')).toBeUndefined()
    expect(parseExtraBody('[1,2]')).toBeUndefined()
    expect(parseExtraBody('"string"')).toBeUndefined()
  })

  it('parses a JSON object', () => {
    expect(parseExtraBody('{"thinking_token_budget":2048}')).toEqual({
      thinking_token_budget: 2048
    })
  })
})

describe('withExtraBody', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns undefined without extra body so the SDK uses its own fetch', () => {
    expect(withExtraBody(undefined)).toBeUndefined()
  })

  it('merges extra fields into JSON request bodies, extra winning', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      seen.push(init!)
      return new Response('{}')
    }) as typeof globalThis.fetch)

    const wrapped = withExtraBody({
      chat_template_kwargs: { thinking: true, reasoning_effort: 'low' },
      thinking_token_budget: 2048,
      model: 'operator-override'
    })!
    await wrapped('http://example.test/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'app-model', messages: [] })
    })

    const body = JSON.parse(seen[0].body as string)
    expect(body.messages).toEqual([])
    expect(body.thinking_token_budget).toBe(2048)
    expect(body.chat_template_kwargs).toEqual({
      thinking: true,
      reasoning_effort: 'low'
    })
    expect(body.model).toBe('operator-override')
  })

  it('forwards non-JSON bodies untouched', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      seen.push(init!)
      return new Response('{}')
    }) as typeof globalThis.fetch)

    const wrapped = withExtraBody({ thinking_token_budget: 2048 })!
    await wrapped('http://example.test/health', { body: 'plain text' })

    expect(seen[0].body).toBe('plain text')
  })
})
