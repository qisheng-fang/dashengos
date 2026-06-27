import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

const BASE = 'https://DBX_HOST/serving-endpoints'
const KEY_ENV = 'DATABRICKS_API_KEY'
const DEFAULT_MODEL = 'databricks-meta-llama-3-1-70b-instruct'

function resolveModel(r: string): string { return r || DEFAULT_MODEL }

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const body: any = { model: resolveModel(req.model || ''), messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: false }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  const resp = await fetch(BASE + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })
  if (!resp.ok) { const t = await resp.text(); throw new Error(`databricks ${resp.status}: ${t.slice(0,200)}`) }
  const d = await resp.json(); const c = d.choices?.[0]
  return { content: c?.message?.content || '', model: d.model || DEFAULT_MODEL, usage: d.usage || { prompt_tokens:0,completion_tokens:0,total_tokens:0 }, finish_reason: c?.finish_reason || 'stop', tool_calls: c?.message?.tool_calls }
}

async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const body: any = { model: resolveModel(req.model || ''), messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: true }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  yield* openAIStream(BASE + '/chat/completions', apiKey, body, signal)
}

async function listModelsImpl(_k: string): Promise<string[]> { return [DEFAULT_MODEL] }
async function testImpl(apiKey: string) { const t0=Date.now(); try { const r=await fetch(BASE+'/models',{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(10000)}); return {ok:r.ok,latency_ms:Date.now()-t0,error:r.ok?undefined:`HTTP ${r.status}`} } catch(e:any) { return {ok:false,latency_ms:Date.now()-t0,error:e.message?.slice(0,100)} } }

const profile: ProviderProfile = {
  name:'databricks', displayName:'Databricks Mosaic', description:'Databricks Mosaic — OpenAI-compatible API', signupUrl:'',
  authType:'api_key', envVars:[KEY_ENV], baseUrl:BASE,
  defaultModel:DEFAULT_MODEL, fallbackModels:[], contextWindow:131072, supportsTools:true, supportsVision:false,
  chat:chatImpl, chatStream:chatStreamImpl, listModels:listModelsImpl, test:testImpl,
}
export default profile
