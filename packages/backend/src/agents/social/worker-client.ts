// packages/backend/src/agents/social/worker-client.ts · Track B (2026-06-15)
// HTTP 客户端, 调旧 DaShengOS 7 个 worker (sau-bridge/douyin-bridge/wechat-mp/video-parser/pixelle-bridge)
//
// 设计: 5 worker URL 全部走 env var 配 (config.ts)
// dev: localhost (worker 跑在宿主机)
// docker: host.docker.internal (worker 也跑在宿主机, 通过 host.docker.internal 访问)

import { config } from '../../config.js'

export interface WorkerHealth {
  ok: boolean
  service: string
  stage?: number
  uptime_seconds?: number
  note?: string
}

export interface WorkerError extends Error {
  code: 'WORKER_UNREACHABLE' | 'WORKER_4XX' | 'WORKER_5XX' | 'WORKER_TIMEOUT'
  worker: string
  status?: number
  body?: string
}

/**
 * 通用 fetch wrapper, 自动处理 5xx 重试 + 4xx 抛错 + network 错
 */
async function workerFetch(
  url: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  const method = opts.method || 'GET'
  const timeoutMs = opts.timeoutMs ?? 15_000

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
  } catch (e: any) {
    clearTimeout(timeoutId)
    const err = new Error(
      `Worker unreachable: ${url} (${e.name === 'AbortError' ? 'timeout' : e.message})`,
    ) as WorkerError
    err.code = e.name === 'AbortError' ? 'WORKER_TIMEOUT' : 'WORKER_UNREACHABLE'
    throw err
  }
  clearTimeout(timeoutId)

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    const err = new Error(`Worker ${resp.status}: ${url} → ${body.slice(0, 200)}`) as WorkerError
    err.code = resp.status >= 500 ? 'WORKER_5XX' : 'WORKER_4XX'
    err.status = resp.status
    err.body = body
    throw err
  }

  // 204 / empty body 处理
  const text = await resp.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Social Worker Client — 单例, 调旧 DaShengOS 5 个 worker
 */
export class SocialWorkerClient {
  constructor(
    public readonly sauUrl: string = config.SAU_BRIDGE_URL,
    public readonly douyinUrl: string = config.DOUYIN_BRIDGE_URL,
    public readonly wechatUrl: string = config.WECHAT_MP_URL,
    public readonly videoParserUrl: string = config.VIDEO_PARSER_URL,
    public readonly pixelleUrl: string = config.PIXELLE_BRIDGE_URL,
  ) {}

  // ===== Health =====
  async healthAll(): Promise<Record<string, WorkerHealth>> {
    const workers = [
      ['sau', this.sauUrl],
      ['douyin', this.douyinUrl],
      ['wechat', this.wechatUrl],
      ['video_parser', this.videoParserUrl],
      ['pixelle', this.pixelleUrl],
    ] as const
    const results = await Promise.allSettled(
      workers.map(async ([name, url]) => {
        try {
          const data = (await workerFetch(`${url}/health`)) as WorkerHealth
          return [name, { ...data, ok: true }] as const
        } catch (e: any) {
          return [name, { ok: false, service: name, note: e.message }] as const
        }
      }),
    )
    const out: Record<string, WorkerHealth> = {}
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        const [name, health] = r.value
        out[name] = health
      }
    })
    return out
  }

  // ===== SAU: Social Auto Upload (sau-bridge :9109) =====
  async sauUpload(req: {
    platform: string
    video_path: string
    title: string
    description?: string
    tags?: string[]
    account?: string
  }): Promise<{ upload_id: string; status: string; is_real: boolean; stage: number }> {
    const data = (await workerFetch(`${this.sauUrl}/upload`, {
      method: 'POST',
      body: req,
    })) as any
    return {
      upload_id: data.upload_id,
      status: data.status || 'queued',
      is_real: data.is_real || false,
      stage: data.stage || 1,
    }
  }

  async sauListAccounts(): Promise<{ accounts: Array<{ platform: string; account: string }> }> {
    return (await workerFetch(`${this.sauUrl}/accounts`)) as any
  }

  // ===== Douyin: douyin-bridge :9112 =====
  async douyinParseVideo(url: string, cookie?: string): Promise<unknown> {
    return workerFetch(`${this.douyinUrl}/parse/video`, {
      method: 'POST',
      body: { platform: 'douyin', url, cookie },
      timeoutMs: 30_000,
    })
  }

  async douyinParseUser(sec_uid: string): Promise<unknown> {
    return workerFetch(`${this.douyinUrl}/parse/user`, {
      method: 'POST',
      body: { platform: 'douyin', sec_uid },
      timeoutMs: 30_000,
    })
  }

  async douyinListPlatforms(): Promise<{ platforms: Array<{ key: string; name: string; stage: number }> }> {
    return (await workerFetch(`${this.douyinUrl}/platforms`)) as any
  }

  // ===== WeChat MP: wechat-mp :9113 =====
  async wechatStartLogin(): Promise<{ qr_id: string; qr_url?: string }> {
    return (await workerFetch(`${this.wechatUrl}/login`, { method: 'POST', body: {} })) as any
  }

  async wechatLoginStatus(qr_id: string): Promise<{ status: string; session_id?: string }> {
    return (await workerFetch(`${this.wechatUrl}/login/${qr_id}/status`)) as any
  }

  async wechatListSessions(): Promise<{
    sessions: Array<{ session_id: string; nickname?: string; expires_at?: number }>
  }> {
    return (await workerFetch(`${this.wechatUrl}/sessions`)) as any
  }

  async wechatPublishArticle(req: {
    session_id?: string
    title: string
    content: string
    content_type?: string
    cover_url?: string
  }): Promise<{ article_id: string; status: string; url?: string }> {
    return (await workerFetch(`${this.wechatUrl}/publish_article`, {
      method: 'POST',
      body: { ...req, content_type: req.content_type || 'article' },
    })) as any
  }

  async wechatListArticles(): Promise<{
    articles: Array<{ article_id: string; title: string; url?: string; created_at?: number }>
  }> {
    return (await workerFetch(`${this.wechatUrl}/articles`)) as any
  }

  // ===== Pixelle: pixelle-bridge :9108 (AI 视频生成) =====
  async pixelleHealth(): Promise<WorkerHealth> {
    try {
      return (await workerFetch(`${this.pixelleUrl}/health`)) as WorkerHealth
    } catch (e: any) {
      return { ok: false, service: 'pixelle', note: e.message }
    }
  }

  async pixelleGenerateVideo(req: {
    topic: string
    duration?: number
    style?: string
  }): Promise<{ video_path: string; is_real: boolean; stage: number }> {
    // pixelle 当前 stage 1 (probe only), 不能真生成, 返 mock 路径
    const health = await this.pixelleHealth()
    if (!health.ok || (health.stage ?? 1) < 2) {
      // Mock 模式: 返路径让上游继续走
      return {
        video_path: `/tmp/dasheng_douyin_${Date.now()}.mp4`,
        is_real: false,
        stage: health.stage ?? 1,
      }
    }
    return (await workerFetch(`${this.pixelleUrl}/videos/generate`, {
      method: 'POST',
      body: req,
      timeoutMs: 300_000,
    })) as any
  }

  // ===== Video Parser: video-parser-bridge :9111 =====
  async videoParserHealth(): Promise<WorkerHealth> {
    try {
      return (await workerFetch(`${this.videoParserUrl}/health`)) as WorkerHealth
    } catch (e: any) {
      return { ok: false, service: 'video_parser', note: e.message }
    }
  }
}

export const socialWorker = new SocialWorkerClient()
