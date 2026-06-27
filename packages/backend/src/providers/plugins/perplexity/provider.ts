import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'
async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const body: any = { model: req.model || 'sonar-pro', messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.2, stream: false }
  const resp = await fetch('https://api.perplexity.ai/chat/completions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`}, body:JSON.stringify(body), signal:AbortSignal.timeout(120_000) })
  if (!resp.ok) { const t = await resp.text(); throw new Error(`Perplexity ${resp.status}: ${t.slice(0,200)}`) }
  const d = await resp.json(); const c = d.choices?.[0]
  return { content: c?.message?.content || '', model: d.model, usage: d.usage || {prompt_tokens:0,completion_tokens:0,total_tokens:0}, finish_reason: c?.finish_reason || 'stop' }
}
async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> { const body: any = { model: req.model || 'sonar-pro', messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.2, stream: true }; yield* openAIStream('https://api.perplexity.ai/chat/completions', apiKey, body, signal) }
async function listModelsImpl(_k: string): Promise<string[]> { return ['sonar-pro','sonar','sonar-reasoning-pro'] }
async function testImpl(apiKey: string) { const t0=Date.now(); try { const r=await fetch('https://api.perplexity.ai/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:'sonar',messages:[{role:'user',content:'hi'}],max_tokens:5}),signal:AbortSignal.timeout(15000)}); return {ok:r.ok,latency_ms:Date.now()-t0,error:r.ok?undefined:`HTTP ${r.status}`} } catch(e:any) { return {ok:false,latency_ms:Date.now()-t0,error:e.message?.slice(0,100)} } }
const profile: ProviderProfile = { name:'perplexity', displayName:'Perplexity', description:'联网搜索增强 · Sonar 系列', signupUrl:'https://www.perplexity.ai/settings/api', authType:'api_key', envVars:['PERPLEXITY_API_KEY'], baseUrl:'https://api.perplexity.ai', defaultModel:'sonar-pro', fallbackModels:['sonar'], contextWindow:128_000, supportsTools:false, supportsVision:false, chat:chatImpl, chatStream:chatStreamImpl, listModels:listModelsImpl, test:testImpl }
export default profile
