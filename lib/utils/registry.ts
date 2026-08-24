import { anthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createProviderRegistry, LanguageModel } from 'ai'
import { createOllama } from 'ai-sdk-ollama'

// Strip a trailing /v1 from the configured base URL, then re-append it,
// so both shapes work for OpenAI-compatible hosts:
//   OPENAI_COMPATIBLE_API_BASE_URL=https://api.deepseek.com
//   OPENAI_COMPATIBLE_API_BASE_URL=https://api.deepseek.com/v1
function normalizeOpenAICompatibleBaseURL(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1'
}

// Operator-defined fields merged into every OpenAI-compatible request body.
// Self-hosted servers take serving knobs as extra body fields the SDK has no
// options for — e.g. vLLM's {"chat_template_kwargs":{"thinking":true,
// "reasoning_effort":"low"},"thinking_token_budget":2048} — and without them
// a reasoning model runs at whatever the server default is.
export function parseExtraBody(
  raw: string | undefined
): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through to the warning below
  }
  console.warn(
    '[registry] Ignoring OPENAI_COMPATIBLE_EXTRA_BODY: not a JSON object'
  )
  return undefined
}

// Env wins over the app on key collisions: the operator set it to override
// server defaults, and the app itself never sends these fields today.
export function withExtraBody(
  extra: Record<string, unknown> | undefined
): typeof globalThis.fetch | undefined {
  if (!extra) return undefined
  return (input, init) => {
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body)
        init = { ...init, body: JSON.stringify({ ...body, ...extra }) }
      } catch {
        // non-JSON body: forward untouched
      }
    }
    return globalThis.fetch(input, init)
  }
}

const openAICompatibleExtraBody = parseExtraBody(
  process.env.OPENAI_COMPATIBLE_EXTRA_BODY
)

// Build providers object conditionally
const providers: Record<string, any> = {
  openai,
  anthropic,
  google,
  'openai-compatible': createOpenAICompatible({
    // Keep the SDK provider key stable. OPENAI_COMPATIBLE_PROVIDER_NAME is
    // only a UI label used by the model selector.
    name: 'openai-compatible',
    apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
    baseURL: normalizeOpenAICompatibleBaseURL(
      process.env.OPENAI_COMPATIBLE_API_BASE_URL || ''
    ),
    fetch: withExtraBody(openAICompatibleExtraBody)
  }),
  gateway: createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY
  })
}

// Only add Ollama if OLLAMA_BASE_URL is configured
const ollamaProvider = process.env.OLLAMA_BASE_URL
  ? createOllama({ baseURL: process.env.OLLAMA_BASE_URL })
  : null

if (ollamaProvider) {
  providers.ollama = ollamaProvider
}

export const registry = createProviderRegistry(providers)

export function getModel(model: string): LanguageModel {
  // For Ollama models, bypass the registry to pass model-level settings
  // that ai-sdk-ollama requires (think, supportedUrls override).
  if (model.startsWith('ollama:') && ollamaProvider) {
    const modelId = model.slice('ollama:'.length)
    const lm = ollamaProvider(modelId, { think: true })

    // Ollama's Chat API only accepts base64 in the images field, not URLs.
    // Override supportedUrls to force AI SDK to download images and convert
    // them to base64 before sending to the model.
    Object.defineProperty(lm, 'supportedUrls', {
      value: {},
      configurable: true
    })

    return lm
  }

  return registry.languageModel(
    model as Parameters<typeof registry.languageModel>[0]
  )
}

export function isProviderEnabled(providerId: string): boolean {
  switch (providerId) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY
    case 'google':
      return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
    case 'openai-compatible':
      return (
        !!process.env.OPENAI_COMPATIBLE_API_KEY &&
        !!process.env.OPENAI_COMPATIBLE_API_BASE_URL
      )
    case 'gateway':
      return !!process.env.AI_GATEWAY_API_KEY
    case 'ollama':
      return !!process.env.OLLAMA_BASE_URL
    default:
      return false
  }
}
