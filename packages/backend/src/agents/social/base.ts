// packages/backend/src/agents/social/base.ts · Track B (2026-06-15)
// SocialAgent ABC — 3 社媒 agent 通用基类
//
// 跟 packages/backend/src/api/agents.ts BUILTIN_AGENTS 格式对齐:
// { id, name, description, category, capabilities, tools, execute(tool, params) }

import type { SocialWorkerClient } from './worker-client.js'

export interface SocialToolDef {
  name: string
  description: string
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean; description?: string }>
  /** when true, 走完整 4 步: crawl → gen → publish → metrics */
  full_chain?: boolean
}

export interface SocialExecuteResult {
  ok: boolean
  content?: string
  data?: unknown
  error?: string
  error_human?: string
  is_real: boolean
  duration_ms: number
  cards?: Array<Record<string, unknown>>
}

export abstract class SocialAgent {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly category: 'social'
  abstract readonly capabilities: string[]
  abstract readonly tools: SocialToolDef[]

  constructor(protected readonly worker: SocialWorkerClient) {}

  /**
   * 主入口 — 调单个 tool 或 auto 全套
   */
  async execute(tool: string, params: Record<string, unknown> = {}): Promise<SocialExecuteResult> {
    const t0 = Date.now()
    try {
      // 'auto' / 空 → 跑该 agent 的所有 full_chain 工具
      if (!tool || tool === 'auto') {
        return await this.runFullChain(params, t0)
      }
      const method = (this as any)[`tool_${tool}`]
      if (typeof method !== 'function') {
        return {
          ok: false,
          error: `Unknown tool: ${tool}`,
          error_human: `${this.name} 不存在工具 ${tool}, 可用: ${this.tools.map((t) => t.name).join(', ')}`,
          is_real: false,
          duration_ms: Date.now() - t0,
        }
      }
      const data = await method.call(this, params)
      return {
        ok: true,
        data,
        is_real: (data as any)?.is_real ?? false,
        duration_ms: Date.now() - t0,
      }
    } catch (e: any) {
      const isUnreachable = e.code === 'WORKER_UNREACHABLE' || e.code === 'WORKER_TIMEOUT'
      return {
        ok: false,
        error: e.message,
        error_human: isUnreachable
          ? `Worker 不可达: ${this.id} 需要外部 worker 服务在跑`
          : `${this.name}.${tool} 失败: ${e.message}`,
        is_real: false,
        duration_ms: Date.now() - t0,
      }
    }
  }

  /**
   * 跑所有标 full_chain 的 tools (顺序)
   * 默认: crawl → generate → publish → metrics
   */
  protected async runFullChain(
    params: Record<string, unknown>,
    t0: number,
  ): Promise<SocialExecuteResult> {
    const fullTools = this.tools.filter((t) => t.full_chain)
    const results: Array<{ step: string; ok: boolean; data?: unknown; error?: string }> = []
    let lastData: any = null
    let anyReal = false

    for (const tool of fullTools) {
      try {
        const method = (this as any)[`tool_${tool.name}`]
        if (typeof method !== 'function') continue
        const data = await method.call(this, { ...params, _prev: lastData })
        results.push({ step: tool.name, ok: true, data })
        lastData = data
        if ((data as any)?.is_real) anyReal = true
      } catch (e: any) {
        results.push({ step: tool.name, ok: false, error: e.message })
        // full_chain 中途失败不阻断, 继续下一步 (e.g. 没有 video_path 时 publish 返 mock)
      }
    }

    return {
      ok: results.some((r) => r.ok),
      data: { steps: results, last_step: lastData },
      is_real: anyReal,
      duration_ms: Date.now() - t0,
      content: `${this.name} 全套完成 ${results.filter((r) => r.ok).length}/${results.length} 步`,
      cards: results.map((r) => ({
        type: 'step',
        title: r.step,
        ok: r.ok,
        data: r.data,
        error: r.error,
      })),
    }
  }

  /** 子类实现具体 tool 方法, 命名约定 `tool_<tool_name>` */
  protected abstract initTools(): void
}
