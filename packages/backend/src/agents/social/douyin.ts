// packages/backend/src/agents/social/douyin.ts · Track B (2026-06-15)
// 抖音运营 Agent — 趋势爬取 / 视频生成 / 发布 / 数据回采
// 工具链: douyin-bridge :9112 + pixelle-bridge :9108 + sau-bridge :9109
// Phase 4 (2026-06-17): generate_video 加 LLM 脚本生成

import { SocialAgent, type SocialToolDef } from './index.js'
import { generateDouyinScript } from './llm-helper.js'

export class DouyinAgent extends SocialAgent {
  readonly id = 'DouyinAgent'
  readonly name = '抖音运营 Agent'
  readonly description = '抖音趋势/视频生成/视频上传/数据回采 (4 步全链路)'
  readonly category = 'social' as const
  readonly capabilities = [
    'douyin_crawl',
    'douyin_publish',
    'douyin_video_gen',
    'douyin_metrics',
    'social_video',
  ]
  readonly tools: SocialToolDef[] = [
    {
      name: 'crawl_trending',
      description: '从 douyin-bridge 拿可用平台 + trending 概览',
      parameters: { topic: { type: 'string', required: false, description: '主题关键词' } },
      full_chain: true,
    },
    {
      name: 'generate_video',
      description: '调 pixelle-bridge 生成视频 (stage<2 时返 mock 路径)',
      parameters: {
        topic: { type: 'string', required: true },
        duration: { type: 'number', required: false },
        style: { type: 'string', required: false },
      },
      full_chain: true,
    },
    {
      name: 'publish_video',
      description: '通过 sau-bridge 上传到抖音, 返 upload_id',
      parameters: {
        video_path: { type: 'string', required: false, description: '本地视频路径, 缺则 mock' },
        title: { type: 'string', required: true },
        description: { type: 'string', required: false },
        tags: { type: 'string', required: false, description: 'JSON 数组字符串' },
      },
      full_chain: true,
    },
    {
      name: 'fetch_metrics',
      description: '从 douyin-bridge 拉视频数据 (likes/views/shares)',
      parameters: {
        video_url: { type: 'string', required: true, description: '抖音视频 URL 或 video_id' },
      },
      full_chain: true,
    },
  ]

  // ============== Tools (供 execute() 调用, 命名 tool_xxx) ==============

  protected async tool_crawl_trending(params: Record<string, unknown>) {
    const platforms = await this.worker.douyinListPlatforms()
    return {
      topic: params.topic || 'general',
      is_real: true,
      platforms: platforms.platforms,
      stage: platforms.platforms?.[0]?.stage ?? 1,
      note: platforms.platforms?.[0]?.stage === 2
        ? 'douyin-bridge 真接入 (Stage 2)'
        : 'douyin-bridge probe 模式, 真实爬取需老板提供 cookie',
    }
  }

  protected async tool_generate_video(params: Record<string, unknown>) {
    const topic = String(params.topic || '')
    // Phase 4: 用 LLM 生成视频脚本
    const script = topic ? await generateDouyinScript(topic) : null
    const result = await this.worker.pixelleGenerateVideo({
      topic,
      duration: params.duration as number | undefined,
      style: params.style as string | undefined,
    })
    return {
      ...result,
      script: script?.is_real ? script.text : undefined,
      script_source: script?.is_real ? 'LLM (SiliconFlow)' : script ? 'fallback' : 'no_topic',
    }
  }

  protected async tool_publish_video(params: Record<string, unknown>) {
    const tags = typeof params.tags === 'string'
      ? (JSON.parse(params.tags) as string[])
      : (params.tags as string[] | undefined) || ['#爱尤趣', '#抖音']
    return await this.worker.sauUpload({
      platform: 'douyin',
      video_path: (params.video_path as string) || (params._prev as any)?.video_path || `/tmp/dasheng_douyin_${Date.now()}.mp4`,
      title: String(params.title || '').slice(0, 64),
      description: (params.description as string) || '',
      tags,
    })
  }

  protected async tool_fetch_metrics(params: Record<string, unknown>) {
    const url = String(params.video_url || '')
    if (!url) {
      return { is_real: false, note: '需要 video_url', metrics: null }
    }
    try {
      const data = await this.worker.douyinParseVideo(url)
      return { is_real: true, metrics: data, source: 'douyin-bridge' }
    } catch {
      return { is_real: false, note: 'douyin-bridge 不可达, mock 返回', metrics: { views: 0, likes: 0 } }
    }
  }

  protected initTools(): void {
    /* tools defined above; methods auto-discovered by execute() */
  }
}
