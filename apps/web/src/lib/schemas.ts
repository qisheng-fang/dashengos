// apps/web/src/lib/schemas.ts · v0.3 spec §34.6
// Zod schemas (Phase 1 本地, Phase 2 迁到 packages/shared/src/schemas/)

import { z } from 'zod'

// Auth
export const LoginSchema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少 8 位').max(128),
  remember: z.boolean().optional(),
})
export type LoginInput = z.infer<typeof LoginSchema>

// Session
export const CreateSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),
  model: z.string().min(1),
  skills: z.array(z.string()).default([]),
})
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>

// Message
export const SendMessageSchema = z.object({
  content: z.string().min(1).max(100_000),
  model: z.string().optional(),
  attachments: z.array(z.string()).default([]),
  stream: z.boolean().default(true),
})
export type SendMessageInput = z.infer<typeof SendMessageSchema>

// Agent
export const AgentCategorySchema = z.enum(['code', 'research', 'design', 'data', 'security', 'custom'])
export type AgentCategory = z.infer<typeof AgentCategorySchema>

// Model
export const ModelProviderSchema = z.enum(['ollama', 'vllm', 'llamacpp', 'openai', 'anthropic'])
export const ModelRefSchema = z.object({
  provider: ModelProviderSchema,
  name: z.string().min(1),
})
export type ModelRef = z.infer<typeof ModelRefSchema>

// Settings
export const SettingsSchema = z.object({
  language: z.enum(['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'ko-KR']).default('zh-CN'),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  defaultModel: z.string().default('ollama:qwen2.5:7b'),
  fallbackModel: z.string().optional(),
  localFirst: z.boolean().default(true),
})
export type Settings = z.infer<typeof SettingsSchema>
