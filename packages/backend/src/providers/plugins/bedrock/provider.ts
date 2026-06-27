import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'

const profile: ProviderProfile = {
  name: 'bedrock',
  displayName: 'AWS Bedrock',
  description: 'AWS Bedrock — requires SDK integration (not OpenAI-compatible)',
  signupUrl: '',
  authType: 'api_key' as const,
  envVars: ['AWS_ACCESS_KEY_ID'],
  baseUrl: 'https://bedrock-runtime.REGION.amazonaws.com',
  defaultModel: 'us.meta.llama3-1-70b-instruct-v1:0',
  fallbackModels: [],
  contextWindow: 131072,
  supportsTools: false,
  supportsVision: false,
  configured: () => !!process.env.AWS_ACCESS_KEY_ID,
  chat: async (): Promise<ChatResponse> => { throw new Error('bedrock requires SDK integration (not OpenAI-compatible)') },
  listModels: async () => [],
  test: async () => { const ok = !!process.env.AWS_ACCESS_KEY_ID; return { ok, latency_ms: 0, error: ok ? undefined : 'AWS_ACCESS_KEY_ID not set' } },
}
export default profile
