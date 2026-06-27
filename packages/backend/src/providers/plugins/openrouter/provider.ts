import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'
async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const body: any = { model: req.model || 'openai/gpt-4o-mini', messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: false }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`,'HTTP-Referer':'https://dashengos.dev'}, body:JSON.stringify(body), signal:AbortSignal.timeout(180_000) })
  if (!resp.ok) { const t = await resp.text(); throw new Error(`OpenRouter ${resp.status}: ${t.slice(0,200)}`) }
  const d = await resp.json(); const c = d.choices?.[0]
  return { content: c?.message?.content || '', model: d.model, usage: d.usage || {prompt_tokens:0,completion_tokens:0,total_tokens:0}, finish_reason: c?.finish_reason || 'stop', tool_calls: c?.message?.tool_calls }
}
async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const body: any = { model: req.model || 'openai/gpt-4o-mini', messages: req.messages, max_tokens: req.max_tokens ?? 4096, temperature: req.temperature ?? 0.7, stream: true }
  if (req.tools?.length) { body.tools = req.tools; body.tool_choice = req.tool_choice || 'auto' }
  yield* openAIStream('https://openrouter.ai/api/v1/chat/completions', apiKey, body, signal)
}
async function listModelsImpl(_k: string): Promise<string[]> { return ['openai/gpt-4o','openai/gpt-4o-mini','anthropic/claude-sonnet-4','google/gemini-2.0-flash','meta-llama/llama-4-maverick','deepseek/deepseek-chat'] }
async function testImpl(apiKey: string) { const t0=Date.now(); try { const r=await fetch('https://openrouter.ai/api/v1/models',{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(10000)}); return {ok:r.ok,latency_ms:Date.now()-t0,error:r.ok?undefined:`HTTP ${r.status}`} } catch(e:any) { return {ok:false,latency_ms:Date.now()-t0,error:e.message?.slice(0,100)} } }
const profile: ProviderProfile = { name:'openrouter', displayName:'OpenRouter', description:'200+ 模型统一 API', signupUrl:'https://openrouter.ai/keys', authType:'api_key', envVars:['OPENROUTER_API_KEY'], baseUrl:'https://openrouter.ai/api/v1', defaultModel:'openai/gpt-4o-mini', fallbackModels:['google/gemini-2.0-flash'], contextWindow:128_000, supportsTools:true, supportsVision:true, chat:chatImpl, chatStream:chatStreamImpl, listModels:listModelsImpl, test:testImpl }
export default profile
