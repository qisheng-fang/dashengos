import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

const MODEL_MAP: Record<string, string> = {
  'openai-gpt4o': 'gpt-4o', 'openai-gpt4mini': 'gpt-4o-mini',
  'openai-o3': 'o3-mini', 'gpt-4o': 'gpt-4o', 'gpt-4o-mini': 'gpt-4o-mini',
}
function resolveModel(r: string): string { return MODEL_MAP[r] || 'gpt-4o-mini' }

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const body: any = { model: resolveModel(req.model || 'gpt-4o-mini'), messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: false }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })
  if (!resp.ok) { const t = await resp.text(); throw new Error(`OpenAI ${resp.status}: ${t.slice(0,200)}`) }
  const d = await resp.json(); const c = d.choices?.[0]
  return { content: c?.message?.content || '', model: d.model, usage: d.usage || { prompt_tokens:0,completion_tokens:0,total_tokens:0 }, finish_reason: c?.finish_reason || 'stop', tool_calls: c?.message?.tool_calls }
}
async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const body: any = { model: resolveModel(req.model || 'gpt-4o-mini'), messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: true }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  yield* openAIStream('https://api.openai.com/v1/chat/completions', apiKey, body, signal)
}
async function listModelsImpl(_k: string): Promise<string[]> { return ['gpt-4o','gpt-4o-mini','o3-mini','gpt-4.1'] }
async function testImpl(apiKey: string) { const t0=Date.now(); try { const r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(10000)}); return {ok:r.ok,latency_ms:Date.now()-t0,error:r.ok?undefined:`HTTP ${r.status}`} } catch(e:any) { return {ok:false,latency_ms:Date.now()-t0,error:e.message?.slice(0,100)} } }

const profile: ProviderProfile = {
  name:'openai', displayName:'OpenAI', description:'GPT-4o / GPT-4o-mini / o3-mini', signupUrl:'https://platform.openai.com/api-keys',
  authType:'api_key', envVars:['OPENAI_API_KEY'], baseUrl:'https://api.openai.com/v1',
  defaultModel:'gpt-4o-mini', fallbackModels:['gpt-4o-mini','gpt-4o'], contextWindow:128_000, supportsTools:true, supportsVision:true,
  chat:chatImpl, chatStream:chatStreamImpl, listModels:listModelsImpl, test:testImpl,
}
export default profile
