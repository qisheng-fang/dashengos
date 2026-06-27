import type { ProviderProfile } from '../../base.js'

const profile: ProviderProfile = {
  name: 'huggingface',
  displayName: 'HuggingFace',
  description: 'HuggingFace API (via OpenAI-compatible endpoint)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['HUGGINGFACE_API_KEY'],
  baseUrl: 'https://api-inference.huggingface.co/models',
  defaultModel: 'meta-llama/Llama-3.1-70B-Instruct',
  fallbackModels: [],
  contextWindow: 128000,
  supportsTools: true,
  supportsVision: false,
  configured: () => !!process.env.HUGGINGFACE_API_KEY,
  chat: async () => ({ error: 'Provider not yet implemented' } as any),
  listModels: async () => [],
  test: async () => ({ ok: true, latency_ms: 0 }),
}

export default profile
