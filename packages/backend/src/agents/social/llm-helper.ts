// packages/backend/src/agents/social/llm-helper.ts · Phase 4 (2026-06-17)
// LLM 内容生成辅助 — 社媒 Agent 调 SiliconFlow 生成真实内容
// 消除硬编码 mock 模板

const LLM_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1'
const LLM_API_KEY = process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY || ''
const LLM_MODEL = process.env.SILICONFLOW_DEFAULT_MODEL || 'Qwen/Qwen2.5-72B-Instruct'

interface GenerateOptions {
  prompt: string
  maxTokens?: number
  temperature?: number
}

interface LLMResult {
  text: string
  is_real: boolean
  model: string
}

/**
 * 调 SiliconFlow (OpenAI 兼容) 生成内容
 */
export async function generateContent(opts: GenerateOptions): Promise<LLMResult> {
  if (!LLM_API_KEY) {
    return {
      text: generateFallback(opts.prompt),
      is_real: false,
      model: 'fallback',
    }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)

    const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: opts.prompt }],
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`LLM ${resp.status}: ${errText.slice(0, 200)}`)
    }

    const data = (await resp.json()) as {
      choices: [{ message: { content: string } }]
      model: string
    }

    return {
      text: data.choices?.[0]?.message?.content || '',
      is_real: true,
      model: data.model || LLM_MODEL,
    }
  } catch (err) {
    return {
      text: generateFallback(opts.prompt),
      is_real: false,
      model: `error: ${(err as Error).message.slice(0, 80)}`,
    }
  }
}

/** 降级模板 — LLM 不可用时返回简单的硬编码内容 */
function generateFallback(prompt: string): string {
  const topic = prompt.slice(0, 100)
  return `## ${topic}

> AI 内容生成引擎暂不可用（请配置 SILICONFLOW_API_KEY）

本文为自动降级生成，接入 LLM key 后可产出高质量原创内容。

要点：
- 主题：${topic}
- 生成时间：${new Date().toISOString()}
- 模式：fallback（降级模板）`
}

/** 生成公众号文章 */
export async function generateWechatArticle(topic: string): Promise<LLMResult> {
  return generateContent({
    prompt: `你是一位微信公众号内容创作者。请以"${topic}"为主题，写一篇结构完整的公众号文章。

要求：
- 标题抓人眼球（不超过30字）
- 开头引入话题（痛点/热点/故事）
- 主体分2-3个小标题展开
- 结尾有总结和互动引导（关注/在看/转发）
- 用 Markdown 格式
- 全文800-1500字
- 风格：专业但不枯燥，有数据支撑观点`,
    maxTokens: 2048,
    temperature: 0.7,
  })
}

/** 生成小红书种草笔记 */
export async function generateXiaohongshuNote(topic: string): Promise<LLMResult> {
  return generateContent({
    prompt: `你是一位小红书种草博主。请以"${topic}"为主题，写一篇小红书种草笔记。

要求：
- 标题带 emoji，吸引女性用户
- 开头个人体验分享（"最近发现..." / "姐妹们..."）
- 列3-5个产品亮点或使用感受
- 结尾带相关话题标签 #话题1 #话题2
- 全文300-800字
- 风格：自然亲切，像朋友聊天`,
    maxTokens: 1024,
    temperature: 0.8,
  })
}

/** 生成抖音视频脚本 */
export async function generateDouyinScript(topic: string): Promise<LLMResult> {
  return generateContent({
    prompt: `你是一位抖音短视频编剧。请以"${topic}"为主题，写一个30-60秒的短视频脚本。

要求：
- 开头3秒必须抓人（疑问/反转/视觉冲击）
- 节奏快，每句话不超过15字
- 分镜描述（画面 + 文案 + 时长）
- 结尾有引导（点赞/关注/评论区）
- 整体风格：年轻化、节奏感强`,
    maxTokens: 512,
    temperature: 0.9,
  })
}
