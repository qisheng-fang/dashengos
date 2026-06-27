// DaShengOS 系统提示词配置 — 独立文件，受保护
// ⚠️ 此文件只能由人工修改，AI Agent 禁止改写
// 修改后需运行 tsc 编译并重启后端生效
//
// 2026-06-25: 重构为包装器 —— 单一真相源是 harness/system-prompt.ts (241行 v6.0)
// 此文件仅提供便捷的 re-export，避免"双源头"问题

// Re-export the authoritative system prompt from the harness
export {
  BRAND_KNOWLEDGE,
  buildSuperSystemPrompt,
  buildLightSystemPrompt,
} from './harness/system-prompt.js'

// HTML 报告设计规范（前端渲染用，非 AI 提示词）
export const HTML_REPORT_STYLE_GUIDE = `
# HTML 报告设计规范
- 主色调：品牌色 + 辅助色 + 强调色
- 布局：hero + 卡片式网格 + 数据可视化
- 字体：系统字体栈
- 禁止用 emoji 当图标，禁止占位符假数据
`

// 触发报告模式的关键词（仅明确要求时触发）
export const REPORT_TRIGGER_KEYWORDS = [
  '生成报告', '写报告', '做报告', '行业报告', '市场报告',
  '调研报告', '分析报告', '生成html', 'html报告', '网页报告',
]

// 向后兼容：默认系统提示词直接使用 harness 的轻量版
import { buildLightSystemPrompt } from './harness/system-prompt.js'
export const DEFAULT_SYSTEM_PROMPT = buildLightSystemPrompt()
