// packages/backend/src/agents/social/wechat.ts · Track B (2026-06-15)
// 微信公众号 Agent — 登录态 / 长文生成 / 文章发布 / 文章列表
// 工具链: wechat-mp-bridge :9113 (5 端点: login/status/sessions/publish_article/articles)
// Phase 4 (2026-06-17): generate_article 接 SiliconFlow LLM 生成真实内容

import { SocialAgent, type SocialToolDef } from './index.js'
import { generateWechatArticle } from './llm-helper.js'

export class WechatAgent extends SocialAgent {
  readonly id = 'WechatAgent'
  readonly name = '微信公众号 Agent'
  readonly description = '公众号登录态/长文生成/文章发布/文章管理 (4 工具)'
  readonly category = 'social' as const
  readonly capabilities = [
    'wechat_publish',
    'wechat_article_gen',
    'wechat_session',
    'social_long_form',
  ]
  readonly tools: SocialToolDef[] = [
    {
      name: 'check_session',
      description: '查公众号登录态 (有 active session 才能发文)',
      parameters: {},
    },
    {
      name: 'generate_article',
      description: '生成公众号长文 (LLM 不可用时返模板)',
      parameters: {
        topic: { type: 'string', required: true },
      },
    },
    {
      name: 'publish_article',
      description: '通过 wechat-mp worker 发文 (需先 check_session)',
      parameters: {
        title: { type: 'string', required: true },
        content: { type: 'string', required: true },
        session_id: { type: 'string', required: false },
      },
    },
    {
      name: 'list_articles',
      description: '列已发布文章',
      parameters: { limit: { type: 'number', required: false } },
    },
    {
      name: 'start_login',
      description: '启动公众号登录 (返 qr_id, 老板人工微信扫码)',
      parameters: {},
    },
  ]

  protected async tool_check_session(_params: Record<string, unknown>) {
    const data = await this.worker.wechatListSessions()
    const sessions = data.sessions || []
    return {
      is_logged_in: sessions.length > 0,
      count: sessions.length,
      sessions: sessions.slice(0, 5),
      is_real: true,
    }
  }

  protected async tool_generate_article(params: Record<string, unknown>) {
    const topic = String(params.topic || '深度分析')
    const result = await generateWechatArticle(topic)
    // 从 LLM 输出中提取标题（第一行 # 开头的）
    const lines = result.text.split('\n')
    let title = `深度分析: ${topic}`.slice(0, 64)
    for (const line of lines) {
      const trimmed = line.replace(/^#+\s*/, '').trim()
      if (trimmed && line.startsWith('#') && trimmed.length <= 60) {
        title = trimmed.slice(0, 64)
        break
      }
    }
    return {
      is_real: result.is_real,
      title,
      content: result.text,
      topic,
      model: result.model,
      note: result.is_real ? 'LLM 生成 (SiliconFlow)' : '降级模板 (请配 SILICONFLOW_API_KEY)',
    }
  }

  protected async tool_publish_article(params: Record<string, unknown>) {
    const title = String(params.title || '').slice(0, 64)  // 公众号标题 64 字限制
    const content = String(params.content || '')
    if (!title || !content) {
      return {
        ok: false,
        is_real: false,
        error: 'title + content 必填',
        error_human: '公众号发文需要标题 + 内容',
      }
    }
    return await this.worker.wechatPublishArticle({
      session_id: params.session_id as string | undefined,
      title,
      content,
      content_type: 'article',
    })
  }

  protected async tool_list_articles(params: Record<string, unknown>) {
    const data = await this.worker.wechatListArticles()
    const limit = (params.limit as number) || 10
    return {
      is_real: true,
      count: data.articles?.length || 0,
      items: (data.articles || []).slice(0, limit),
    }
  }

  protected async tool_start_login(_params: Record<string, unknown>) {
    return await this.worker.wechatStartLogin()
  }

  protected initTools(): void {
    /* tools defined above */
  }
}
