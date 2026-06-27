import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'

const profile: ProviderProfile = {
  name: 'vertex',
  displayName: 'Google Vertex AI',
  description: 'Google Vertex AI — requires SDK integration (not OpenAI-compatible)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['GOOGLE_APPLICATION_CREDENTIALS'],
  baseUrl: 'https://LOCATION-aiplatform.googleapis.com/v1',
  defaultModel: 'gemini-2.5-flash',
  fallbackModels: [],
  contextWindow: 1048576,
  supportsTools: false,
  supportsVision: false,
  configured: () => !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
  chat: async (): Promise<ChatResponse> => { throw new Error('vertex requires SDK integration (not OpenAI-compatible)') },
  listModels: async () => [],
  test: async () => { const ok = !!process.env.GOOGLE_APPLICATION_CREDENTIALS; return { ok, latency_ms: 0, error: ok ? undefined : 'GOOGLE_APPLICATION_CREDENTIALS not set' } },
}
export default profile
