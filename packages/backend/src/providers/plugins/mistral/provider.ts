import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'
async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const body: any = { model: req.model || 'mistral-large-latest', messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: false }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`}, body:JSON.stringify(body), signal:AbortSignal.timeout(120_000) })
  if (!resp.ok) { const t = await resp.text(); throw new Error(`Mistral ${resp.status}: ${t.slice(0,200)}`) }
  const d = await resp.json(); const c = d.choices?.[0]
  return { content: c?.message?.content || '', model: d.model, usage: d.usage || {prompt_tokens:0,completion_tokens:0,total_tokens:0}, finish_reason: c?.finish_reason || 'stop', tool_calls: c?.message?.tool_calls }
}
async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> { const body: any = { model: req.model || 'mistral-large-latest', messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: true }; if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }; yield* openAIStream('https://api.mistral.ai/v1/chat/completions', apiKey, body, signal) }
async function listModelsImpl(_k: string): Promise<string[]> { return ['mistral-large-latest','mistral-small-latest','pixtral-large-latest','codestral-latest'] }
async function testImpl(apiKey: string) { const t0=Date.now(); try { const r=await fetch('https://api.mistral.ai/v1/models',{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(10000)}); return {ok:r.ok,latency_ms:Date.now()-t0,error:r.ok?undefined:`HTTP ${r.status}`} } catch(e:any) { return {ok:false,latency_ms:Date.now()-t0,error:e.message?.slice(0,100)} } }
const profile: ProviderProfile = { name:'mistral', displayName:'Mistral AI', description:'Mistral Large / Small / Codestral', signupUrl:'https://console.mistral.ai/', authType:'api_key', envVars:['MISTRAL_API_KEY'], baseUrl:'https://api.mistral.ai/v1', defaultModel:'mistral-large-latest', fallbackModels:['mistral-small-latest'], contextWindow:128_000, supportsTools:true, supportsVision:true, chat:chatImpl, chatStream:chatStreamImpl, listModels:listModelsImpl, test:testImpl }
export default profile
