// packages/backend/src/agents/social/xiaohongshu.ts · Track B (2026-06-15)
// 小红书运营 Agent — 趋势 / 图文笔记 / 种草发布
// 工具链: video-parser-bridge :9111 (trending) + sau-bridge :9109 (xiaohongshu uploader)
// Phase 4 (2026-06-17): generate_xhs_note 接 SiliconFlow LLM 生成真实内容

import { SocialAgent, type SocialToolDef } from './index.js'
import { generateXiaohongshuNote } from './llm-helper.js'

export class XiaohongshuAgent extends SocialAgent {
  readonly id = 'XiaohongshuAgent'
  readonly name = '小红书运营 Agent'
  readonly description = '小红书图文笔记/种草发布/数据监控 (3 步全链路)'
  readonly category = 'social' as const
  readonly capabilities = [
    'xhs_crawl',
    'xhs_publish',
    'xhs_note_gen',
    'social_note',
  ]
  readonly tools: SocialToolDef[] = [
    {
      name: 'crawl_xhs_trending',
      description: '从 video-parser 拿小红书 trending',
      parameters: { topic: { type: 'string', required: false } },
      full_chain: true,
    },
    {
      name: 'generate_xhs_note',
      description: '生成小红书笔记文案 (LLM 不可用时返模板)',
      parameters: {
        topic: { type: 'string', required: true },
        tone: { type: 'string', required: false, description: '种草/分享/教程' },
      },
      full_chain: true,
    },
    {
      name: 'publish_xhs_note',
      description: '通过 sau-bridge 上传到小红书',
      parameters: {
        title: { type: 'string', required: true },
        content: { type: 'string', required: true },
        image_path: { type: 'string', required: false, description: '首图路径, 缺则 mock' },
      },
      full_chain: true,
    },
  ]

  protected async tool_crawl_xhs_trending(params: Record<string, unknown>) {
    const health = await this.worker.videoParserHealth()
    return {
      topic: params.topic || 'general',
      is_real: health.ok,
      stage: health.stage ?? 1,
      note: health.ok ? 'video-parser 真接入' : 'video-parser 不可达, mock trending',
      items: health.ok
        ? [{ platform: '小红书', topic: params.topic || 'general', stage: health.stage }]
        : [{ platform: '小红书', topic: params.topic || 'general', stage: 1, mock: true }],
    }
  }

  protected async tool_generate_xhs_note(params: Record<string, unknown>) {
    const topic = String(params.topic || '种草')
    const tone = String(params.tone || '种草/分享')
    const result = await generateXiaohongshuNote(topic)
    return {
      is_real: result.is_real,
      content: result.text,
      topic,
      tone,
      character_count: result.text.length,
      model: result.model,
      note: result.is_real ? 'LLM 生成 (SiliconFlow)' : '降级模板 (请配 SILICONFLOW_API_KEY)',
    }
  }

  protected async tool_publish_xhs_note(params: Record<string, unknown>) {
    const title = String(params.title || '').slice(0, 30)  // 小红书标题 30 字限制
    const content = String(params.content || '')
    return await this.worker.sauUpload({
      platform: 'xiaohongshu',
      video_path: (params.image_path as string) || `/tmp/dasheng_xhs_${Date.now()}.png`,
      title,
      description: content,
      tags: ['#爱尤趣', '#小红书种草', `#${title.replace(/\s/g, '')}`],
    })
  }

  protected initTools(): void {
    /* tools defined above */
  }
}
