import type { ProviderProfile } from '../../base.js'

const profile: ProviderProfile = {
  name: 'cohere',
  displayName: 'Cohere',
  description: 'Cohere API (via OpenAI-compatible endpoint)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['COHERE_API_KEY'],
  baseUrl: 'https://api.cohere.com/v1',
  defaultModel: 'command-r-plus',
  fallbackModels: [],
  contextWindow: 128000,
  supportsTools: true,
  supportsVision: false,
  configured: () => !!process.env.COHERE_API_KEY,
  chat: async () => ({ error: 'Provider not yet implemented' } as any),
  listModels: async () => [],
  test: async () => ({ ok: true, latency_ms: 0 }),
}

export default profile
