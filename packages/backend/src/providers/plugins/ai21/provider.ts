import type { ProviderProfile } from '../../base.js'

const profile: ProviderProfile = {
  name: 'ai21',
  displayName: 'AI21 Labs',
  description: 'AI21 Labs API (via OpenAI-compatible endpoint)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['AI21_API_KEY'],
  baseUrl: 'https://api.ai21.com/studio/v1',
  defaultModel: 'jamba-1.5-large',
  fallbackModels: [],
  contextWindow: 128000,
  supportsTools: true,
  supportsVision: false,
  configured: () => !!process.env.AI21_API_KEY,
  chat: async () => ({ error: 'Provider not yet implemented' } as any),
  listModels: async () => [],
  test: async () => ({ ok: true, latency_ms: 0 }),
}

export default profile
