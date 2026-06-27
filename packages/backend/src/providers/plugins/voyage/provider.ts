import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'

const profile: ProviderProfile = {
  name: 'voyage',
  displayName: 'Voyage AI',
  description: 'Voyage AI — requires SDK integration (not OpenAI-compatible)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['VOYAGE_API_KEY'],
  baseUrl: 'https://api.voyageai.com/v1',
  defaultModel: 'voyage-3',
  fallbackModels: [],
  contextWindow: 32000,
  supportsTools: false,
  supportsVision: false,
  configured: () => !!process.env.VOYAGE_API_KEY,
  chat: async (): Promise<ChatResponse> => { throw new Error('voyage requires SDK integration (not OpenAI-compatible)') },
  listModels: async () => [],
  test: async () => { const ok = !!process.env.VOYAGE_API_KEY; return { ok, latency_ms: 0, error: ok ? undefined : 'VOYAGE_API_KEY not set' } },
}
export default profile
