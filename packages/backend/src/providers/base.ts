// packages/backend/src/providers/base.ts · D3.1 (2026-06-17)
// 仿 Hermes ProviderProfile - 单一基类,所有 provider 继承

import type { StreamChunk } from './streaming.js'

export interface ChatRequest {
  model?: string
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_call_id?: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
  // Agent Runtime: function calling support
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: any } }>
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export interface ChatResponse {
  content: string
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string
  // Agent Runtime: tool_calls from function calling response
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
}

export interface ProviderProfile {
  // Identity
  name: string                            // 'siliconflow'
  displayName: string                      // 'SiliconFlow (硅基流动)'
  description: string                     // 一句话介绍
  signupUrl: string                       // 注册链接

  // Auth
  authType: 'api_key' | 'oauth' | 'aws_sdk' | 'none'
  envVars: string[]                       // ['SILICONFLOW_API_KEY']

  // Endpoints
  baseUrl: string                         // 'https://api.siliconflow.cn/v1'
  modelsUrl?: string                      // 默认 {baseUrl}/models

  // Client quirks
  defaultHeaders?: Record<string, string>
  fixedTemperature?: number | null

  // Model catalog
  defaultModel: string                    // 'Qwen/Qwen2.5-72B-Instruct'
  fallbackModels: string[]                // 用于 list_models 失败时回退
  contextWindow: number                   // 上下文窗口
  supportsTools: boolean
  supportsVision: boolean

  // Core API
  chat: (req: ChatRequest, apiKey: string) => Promise<ChatResponse>
  chatStream?: (req: ChatRequest, apiKey: string, signal?: AbortSignal) => AsyncGenerator<StreamChunk>
  listModels: (apiKey: string) => Promise<string[]>
  test: (apiKey: string) => Promise<{ ok: boolean; latency_ms: number; error?: string; model_count?: number }>

  // Meta
  pluginPath?: string                     // 由 loader 注入
}

export interface ProviderListItem {
  name: string
  displayName: string
  description: string
  authType: string
  configured: boolean
  envVars: string[]
  model: string
  signupUrl: string
}
