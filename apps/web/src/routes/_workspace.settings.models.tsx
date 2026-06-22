// apps/web/src/routes/_workspace.settings.models.tsx · Track C.3 (2026-06-15)
// 模型路由父路由: 3-tab 切换 (文本 / 多模态 / 厂商) + Outlet 渲染子路由
// 跟 5 份 .md 规划文档 (创作台方案 §2.5 "升级方案 C: UI 拆三页") 一致

import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { Cpu, Image as ImageIcon, Building2, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

const SUB_TABS = [
  { to: '/settings/models/text', label: '文本模型', icon: Cpu, desc: '文本对话 / 推理 (Qwen / GPT / Claude / DeepSeek)' },
  { to: '/settings/models/multimodal', label: '多模态', icon: ImageIcon, desc: '图像 / 视频 / 音频 / TTS 模型绑定' },
  { to: '/settings/models/provider', label: '厂商管理', icon: Building2, desc: 'DeepSeek / SiliconFlow / OpenAI / Anthropic / Ollama 凭证 + 健康' },
  { to: '/settings/models/custom', label: '自定义模型', icon: Wrench, desc: '添加任意第三方模型 + 自定义 API 端点' },
]

export const Route = createFileRoute('/_workspace/settings/models')({
  component: ModelsLayout,
})

export function ModelsLayout() {
  const location = useLocation()
  return (
    <div className="space-y-4" data-testid="settings-models-layout">
      <p className="text-sm text-neutral-400">
        多模态路由设置 — 4 子页分离 (文本 / 多模态 / 厂商 / 自定义), 跟 DaShengOS 模型路由方案对齐
      </p>
      <nav className="flex gap-1.5 flex-wrap" role="tablist" aria-label="模型路由子页">
        {SUB_TABS.map((t) => {
          const Icon = t.icon
          const isActive = location.pathname === t.to
          return (
            <Link
              key={t.to}
              to={t.to}
              role="tab"
              aria-selected={isActive}
              data-testid={`models-tab-${t.to.split('/').pop()}`}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded border text-sm transition-colors',
                isActive
                  ? 'bg-brand/15 border-brand text-brand ring-1 ring-brand/40'
                  : 'border-neutral-800 bg-neutral-900/30 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100',
              )}
            >
              <Icon size={14} aria-hidden="true" />
              <div>
                <div className="text-xs font-medium">{t.label}</div>
                <div className="text-[10px] text-neutral-500 mt-0.5">{t.desc}</div>
              </div>
            </Link>
          )
        })}
      </nav>
      <Outlet />
    </div>
  )
}
