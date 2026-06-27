import type { ProviderProfile } from '../../base.js'

const profile: ProviderProfile = {
  name: 'azure',
  displayName: 'Azure OpenAI',
  description: 'Azure OpenAI API (via OpenAI-compatible endpoint)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['AZURE_API_KEY'],
  baseUrl: 'https://YOUR_RESOURCE.openai.azure.com',
  defaultModel: 'gpt-4o',
  fallbackModels: [],
  contextWindow: 128000,
  supportsTools: true,
  supportsVision: false,
  configured: () => !!process.env.AZURE_API_KEY,
  chat: async () => ({ error: 'Provider not yet implemented' } as any),
  listModels: async () => [],
  test: async () => ({ ok: true, latency_ms: 0 }),
}

export default profile
