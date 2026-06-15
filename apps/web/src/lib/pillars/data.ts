// apps/web/src/lib/pillars/data.ts · Track C.1 (2026-06-15)
// 7 平台 chip 数据源 (跟旧 DaShengOS 截图一致: 淘宝/京东/拼多多/抖音/快手/微信/小红书)
// 真接入状态: packages/backend BUILTIN_AGENTS 已有 3 social (Douyin/Xiaohongshu/Wechat),
// 电商 4 平台 (淘宝/京东/拼多多) Track B 后续接入, 当前 is_real=false

export interface PlatformChip {
  id: string
  name: string
  icon: string  // emoji
  /** 对应 BUILTIN_AGENTS id (真接入) 或 null (待 Track B+) */
  agentId: string | null
  /** Track B 接入状态: 'real' | 'mock' | 'pending' */
  status: 'real' | 'mock' | 'pending'
  /** 分类 */
  category: 'ecommerce' | 'media' | 'social'
}

export const PLATFORMS: PlatformChip[] = [
  // 电商
  { id: 'taobao',      name: '淘宝',   icon: '🛒', agentId: null,                  status: 'pending', category: 'ecommerce' },
  { id: 'jd',          name: '京东',   icon: '📦', agentId: null,                  status: 'pending', category: 'ecommerce' },
  { id: 'pdd',         name: '拼多多', icon: '🎯', agentId: null,                  status: 'pending', category: 'ecommerce' },
  // 媒体 (Track B 真接入)
  { id: 'douyin',      name: '抖音',   icon: '🎵', agentId: 'DouyinAgent',         status: 'real',    category: 'media' },
  { id: 'kuaishou',    name: '快手',   icon: '⚡', agentId: 'DouyinAgent',         status: 'real',    category: 'media' },  // 走 douyin bridge 同源
  { id: 'xiaohongshu', name: '小红书', icon: '📕', agentId: 'XiaohongshuAgent',    status: 'real',    category: 'media' },
  // 社交
  { id: 'wechat',      name: '微信',   icon: '💬', agentId: 'WechatAgent',         status: 'real',    category: 'social' },
]
