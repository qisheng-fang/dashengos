import type { ProviderProfile } from '../../base.js'

const profile: ProviderProfile = {
  name: 'replicate',
  displayName: 'Replicate',
  description: 'Replicate API (via OpenAI-compatible endpoint)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['REPLICATE_API_KEY'],
  baseUrl: 'https://api.replicate.com/v1',
  defaultModel: 'meta/llama-3.1-405b-instruct',
  fallbackModels: [],
  contextWindow: 128000,
  supportsTools: true,
  supportsVision: false,
  configured: () => !!process.env.REPLICATE_API_KEY,
  chat: async () => ({ error: 'Provider not yet implemented' } as any),
  listModels: async () => [],
  test: async () => ({ ok: true, latency_ms: 0 }),
}

export default profile
