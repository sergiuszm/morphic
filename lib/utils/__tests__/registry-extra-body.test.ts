import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EFFORT_PROFILE_HEADER,
  parseExtraBody,
  withExtraBody
} from '../registry'

function captureFetch() {
  const seen: RequestInit[] = []
  vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
    seen.push(init!)
    return new Response('{}')
  }) as typeof globalThis.fetch)
  return seen
}

describe('parseExtraBody', () => {
  it('returns undefined for unset or empty values', () => {
    expect(parseExtraBody(undefined, 'X')).toBeUndefined()
    expect(parseExtraBody('', 'X')).toBeUndefined()
  })

  it('returns undefined for invalid JSON and non-objects', () => {
    expect(parseExtraBody('not json', 'X')).toBeUndefined()
    expect(parseExtraBody('[1,2]', 'X')).toBeUndefined()
    expect(parseExtraBody('"string"', 'X')).toBeUndefined()
  })

  it('parses a JSON object', () => {
    expect(parseExtraBody('{"thinking_token_budget":2048}', 'X')).toEqual({
      thinking_token_budget: 2048
    })
  })
})

describe('withExtraBody', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns undefined without any profile so the SDK uses its own fetch', () => {
    expect(withExtraBody(undefined)).toBeUndefined()
    expect(withExtraBody({})).toBeUndefined()
  })

  it('merges the base profile into JSON request bodies, env winning', async () => {
    const seen = captureFetch()
    const wrapped = withExtraBody({
      base: {
        chat_template_kwargs: { thinking: true, reasoning_effort: 'low' },
        thinking_token_budget: 2048,
        model: 'operator-override'
      }
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

  it('applies the profile named by the header over base and strips it', async () => {
    const seen = captureFetch()
    const wrapped = withExtraBody({
      base: { thinking_token_budget: 2048 },
      adaptive: { thinking_token_budget: 8192 }
    })!
    await wrapped('http://example.test/v1/chat/completions', {
      method: 'POST',
      headers: { [EFFORT_PROFILE_HEADER]: 'adaptive', 'x-keep': 'yes' },
      body: JSON.stringify({ messages: [] })
    })

    const body = JSON.parse(seen[0].body as string)
    expect(body.thinking_token_budget).toBe(8192)
    const headers = new Headers(seen[0].headers as HeadersInit)
    expect(headers.get(EFFORT_PROFILE_HEADER)).toBeNull()
    expect(headers.get('x-keep')).toBe('yes')
  })

  it('falls back to base for requests without the header', async () => {
    const seen = captureFetch()
    const wrapped = withExtraBody({
      base: { thinking_token_budget: 2048 },
      adaptive: { thinking_token_budget: 8192 }
    })!
    await wrapped('http://example.test/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [] })
    })

    expect(JSON.parse(seen[0].body as string).thinking_token_budget).toBe(2048)
  })

  it('forwards non-JSON bodies untouched', async () => {
    const seen = captureFetch()
    const wrapped = withExtraBody({ base: { thinking_token_budget: 2048 } })!
    await wrapped('http://example.test/health', { body: 'plain text' })

    expect(seen[0].body).toBe('plain text')
  })
})
