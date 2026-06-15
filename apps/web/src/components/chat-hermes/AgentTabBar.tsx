// apps/web/src/components/chat-hermes/AgentTabBar.tsx · Track C.1 (2026-06-15)
// 8 Agent tab 切换器 (跟旧 DaShengOS 截图一致: 总入口/电商/内容/CRM/客服/广告/工作流/主动营销)
//
// v0.3 实际只接了 6 builtin + 3 social, 8 tab 映射关系:
//   1. 总入口 (master / default)        → DeerFlow :8001
//   2. 电商 (EcommerceAgent)              → sandbox (no frontend yet)
//   3. 内容 (ContentAgent — TBD)          → 真接 backend (Track C+)
//   4. CRM (CRMAgent)                     → sandbox
//   5. 客服 (CustomerServiceAgent)        → sandbox
//   6. 广告 (AdAgent)                     → sandbox
//   7. 工作流 (WorkflowAgent)             → sandbox
//   8. 主动营销 (ProactiveAgent)          → sandbox
// Track B.3 额外: 3 社媒 tab (Douyin/Xhs/Wechat) 替换 tab 2-4 位置 (因为更直接)

import { useNavigate } from '@tanstack/react-router'
import { Bot, ShoppingCart, Users, Headphones, Megaphone, Workflow, Bell, Video, BookOpen, Newspaper } from 'lucide-react'
import { cn } from '@/lib/cn'

export type AgentTabId =
  | 'default'        // 总入口 (DeerFlow)
  | 'EcommerceAgent' // 电商
  | 'DouyinAgent'    // 抖音 (Track B)
  | 'XiaohongshuAgent' // 小红书 (Track B)
  | 'WechatAgent'    // 微信 (Track B)
  | 'CRMAgent'       // CRM
  | 'CustomerServiceAgent' // 客服
  | 'AdAgent'        // 广告
  | 'WorkflowAgent'  // 工作流
  | 'ProactiveAgent' // 主动营销

interface TabConfig {
  id: AgentTabId
  name: string
  icon: typeof Bot
  /** social / sandbox / llm 3 类路由: 决定 send() 走哪条 */
  route: 'social' | 'sandbox' | 'llm'
  /** Track B/C 真接入状态 */
  real: boolean
}

const TABS: TabConfig[] = [
  { id: 'default',              name: '总入口',  icon: Bot,          route: 'llm',     real: true  },
  { id: 'EcommerceAgent',       name: '电商',    icon: ShoppingCart, route: 'sandbox', real: true  },
  { id: 'DouyinAgent',          name: '抖音',    icon: Video,        route: 'social',  real: true  },
  { id: 'XiaohongshuAgent',     name: '小红书',  icon: BookOpen,     route: 'social',  real: true  },
  { id: 'WechatAgent',          name: '微信',    icon: Newspaper,    route: 'social',  real: true  },
  { id: 'CRMAgent',             name: 'CRM',     icon: Users,        route: 'sandbox', real: true  },
  { id: 'CustomerServiceAgent', name: '客服',    icon: Headphones,   route: 'sandbox', real: true  },
  { id: 'AdAgent',              name: '广告',    icon: Megaphone,    route: 'sandbox', real: true  },
  { id: 'WorkflowAgent',        name: '工作流',  icon: Workflow,     route: 'sandbox', real: true  },
  { id: 'ProactiveAgent',       name: '主动营销', icon: Bell,        route: 'sandbox', real: true  },
  // 未来: 内容 (FileText), 内容生成 agent 跟 content 屏协同
]

/** 8 tab UI (当前 10 个, 含 3 社媒 Track B.3 加) */
export const AGENT_TABS = TABS

export function AgentTabBar({
  active,
  onChange,
}: {
  active?: AgentTabId
  onChange?: (id: AgentTabId) => void
}) {
  const navigate = useNavigate()

  function handleClick(tab: TabConfig) {
    onChange?.(tab.id)
    // social tab → 跳 Chat 屏 + pending_agent 注入
    if (tab.route === 'social') {
      const threadId = `t_${Date.now().toString(36)}_${tab.id}`
      sessionStorage.setItem(`pending_agent_${threadId}`, tab.id)
      sessionStorage.setItem(`pending_msg_${threadId}`, `用 ${tab.name} agent 帮我做点事`)
      navigate({ to: '/chats/$id', params: { id: threadId } })
    }
    // sandbox / llm tab → 当前 Chat 屏直接发 (TODO Track C.2+ 增强)
  }

  return (
    <div
      className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1 overflow-x-auto"
      data-testid="agent-tab-bar"
      role="tablist"
      aria-label="Agent 切换"
    >
      {TABS.map((t) => {
        const Icon = t.icon
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => handleClick(t)}
            disabled={!t.real}
            data-testid={`agent-tab-bar-${t.id}`}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors flex-shrink-0',
              isActive
                ? 'bg-brand/15 text-brand ring-1 ring-brand/40'
                : t.real
                  ? 'text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 cursor-pointer'
                  : 'text-neutral-600 cursor-not-allowed',
            )}
            title={`${t.name} · ${t.real ? '真接入' : 'mock'}`}
          >
            <Icon size={13} aria-hidden="true" />
            <span className="hidden md:inline">{t.name}</span>
            {t.real && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-label="真接入" />
            )}
          </button>
        )
      })}
    </div>
  )
}
