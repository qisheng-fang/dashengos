// apps/web/src/components/studio/nodes.ts · Track C.2 (2026-06-15)
// ComfyUI 式工作流节点定义 (7 类, 跟 Track B 3 社媒 + 视频/解析/内容/数据对齐)

export type StudioNodeKind =
  | 'douyin'          // Track B · 抖音运营
  | 'xiaohongshu'     // Track B · 小红书运营
  | 'wechat'          // Track B · 微信公众号
  | 'video_gen'       // Pixelle AI 视频生成
  | 'video_parse'     // 视频解析
  | 'content'         // LLM 内容生成
  | 'data_crawl'      // 数据回采

export interface StudioNodeSpec {
  kind: StudioNodeKind
  label: string
  description: string
  category: 'social' | 'media' | 'ai' | 'data'
  icon: string  // lucide name (动态 import)
  color: string
  /** 节点输入 (上游节点 handle 名) */
  inputs: Array<{ id: string; label: string; type: 'string' | 'image' | 'video' }>
  /** 节点输出 (下游节点 handle 名) */
  outputs: Array<{ id: string; label: string; type: 'string' | 'image' | 'video' }>
  /** 默认参数 (点 + 拖到画布时用) */
  defaultParams: Record<string, unknown>
}

export const STUDIO_NODES: StudioNodeSpec[] = [
  // === Track B · 3 社媒 ===
  {
    kind: 'douyin',
    label: '抖音发布',
    description: '通过 sau-bridge 调抖音上传 (Track B 真接入)',
    category: 'social',
    icon: 'Video',
    color: '#FE2C55',
    inputs: [{ id: 'in', label: '视频', type: 'video' }],
    outputs: [{ id: 'out', label: 'upload_id', type: 'string' }],
    defaultParams: { platform: 'douyin', title: '新视频', tags: ['#爱尤趣'] },
  },
  {
    kind: 'xiaohongshu',
    label: '小红书种草',
    description: '通过 sau-bridge 调小红书 uploader (Track B 真接入)',
    category: 'social',
    icon: 'BookOpen',
    color: '#FF2442',
    inputs: [{ id: 'in', label: '图文', type: 'image' }],
    outputs: [{ id: 'out', label: 'note_id', type: 'string' }],
    defaultParams: { platform: 'xiaohongshu', title: '新笔记' },
  },
  {
    kind: 'wechat',
    label: '公众号发文',
    description: '通过 wechat-mp :9113 发文 (Track B 真接入)',
    category: 'social',
    icon: 'Newspaper',
    color: '#07C160',
    inputs: [{ id: 'in', label: '内容', type: 'string' }],
    outputs: [{ id: 'out', label: 'article_id', type: 'string' }],
    defaultParams: { title: '新文章', content: '# 标题\n\n## 正文' },
  },
  // === AI 视频/解析 ===
  {
    kind: 'video_gen',
    label: 'AI 视频生成',
    description: '调 Pixelle 视频生成 (theme → 文案 + 配图 + TTS + 合成)',
    category: 'media',
    icon: 'Sparkles',
    color: '#8B5CF6',
    inputs: [{ id: 'in', label: '主题', type: 'string' }],
    outputs: [{ id: 'out', label: 'video_path', type: 'video' }],
    defaultParams: { topic: 'AI 工具', duration: 30 },
  },
  {
    kind: 'video_parse',
    label: '视频解析',
    description: '调 video-parser 解析抖音/小红书视频元数据',
    category: 'media',
    icon: 'FileSearch',
    color: '#06B6D4',
    inputs: [{ id: 'in', label: 'URL', type: 'string' }],
    outputs: [{ id: 'out', label: 'metadata', type: 'string' }],
    defaultParams: { url: 'https://www.douyin.com/video/xxx' },
  },
  // === 内容生成 (LLM) ===
  {
    kind: 'content',
    label: 'LLM 内容生成',
    description: '调 backend /api/v1/sessions/:id/messages (DeerFlow Qwen2.5-72B)',
    category: 'ai',
    icon: 'Bot',
    color: '#6366F1',
    inputs: [{ id: 'in', label: 'Prompt', type: 'string' }],
    outputs: [{ id: 'out', label: 'content', type: 'string' }],
    defaultParams: { prompt: '为 {topic} 写一段 30 字抖音文案' },
  },
  // === 数据回采 ===
  {
    kind: 'data_crawl',
    label: '数据回采',
    description: '调 douyin-bridge 拉 trending/榜单数据',
    category: 'data',
    icon: 'TrendingUp',
    color: '#F59E0B',
    inputs: [{ id: 'in', label: 'topic', type: 'string' }],
    outputs: [{ id: 'out', label: 'metrics', type: 'string' }],
    defaultParams: { topic: 'AI 工具', platform: 'douyin' },
  },
]

/** 按 category 分组, 给 NodePalette 渲染 */
export function nodesByCategory(): Record<StudioNodeSpec['category'], StudioNodeSpec[]> {
  const out: Record<StudioNodeSpec['category'], StudioNodeSpec[]> = {
    social: [],
    media: [],
    ai: [],
    data: [],
  }
  for (const n of STUDIO_NODES) {
    out[n.category].push(n)
  }
  return out
}
