// screens/CommandCenter.tsx · LUI + GUI 双栏主布局
// ----------------------------------------------------------------------
// 左 35%: ChatCopilot (对话中枢, 驱动意图)
// 右 65%: 动态画布 (根据 activeIntent 渲染对应面板, 默认显示仪表盘)
// framer-motion 做面板切换动画
// ----------------------------------------------------------------------

import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store/useAppStore'
import { useUIStore } from '@/store/ui'
import { useAuthStore } from '@/lib/auth-store'
import { useEffect, useState } from 'react'
import ChatCopilot from '@/components/ChatCopilot'
import ConversationHistory from '@/components/ConversationHistory'
import ConfirmationGate from '@/components/ConfirmationGate'  // P3 · 写操作确认门
import ModelGeneratorPanel from '@/components/panels/ModelGeneratorPanel'
import S2B2CDeployPanel from '@/components/panels/S2B2CDeployPanel'
import MarketingSOPPanel from '@/components/panels/MarketingSOPPanel'
import { Image, Globe, FileText, Cpu, Activity, Zap, ArrowRight } from 'lucide-react'

/** 快捷意图入口 */
const QUICK_INTENTS = [
  { intent: 'generate_model' as const, label: '数字人与视觉资产', desc: 'AI 写实照 / 数字人 / 商品图', icon: Image, color: 'from-brand/20 to-brand/5' },
  { intent: 'deploy_s2b2c' as const, label: 'S2B2C 跨境部署', desc: '独立站 / 跨境架构 / 区域拓扑', icon: Globe, color: 'from-emerald-500/20 to-emerald-500/5' },
  { intent: 'marketing_sop' as const, label: '私域内容与 SOP', desc: '公众号 / 社群运营 / 内容日历', icon: FileText, color: 'from-blue-500/20 to-blue-500/5' },
]

/** 默认仪表盘 */
function DefaultDashboard() {
  const { setActiveIntent } = useAppStore()
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const { chatHistory } = useAppStore()

  useEffect(() => {
    const token = useAuthStore.getState().accessToken
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/v1/dashboard', { headers })
      .then((r) => setBackendStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setBackendStatus('offline'))
  }, [])

  const recentMsgs = chatHistory.filter((m) => m.role === 'assistant').slice(-3)

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-neutral-100 mb-2">工作台仪表盘</h2>
        <p className="text-sm text-neutral-500">选择一个工作流开始，或在左侧输入指令</p>
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-1 gap-4 mb-8">
        {QUICK_INTENTS.map((item) => (
          <button
            key={item.intent}
            onClick={() => setActiveIntent(item.intent)}
            className={`group relative text-left p-5 rounded-xl border border-neutral-800 bg-gradient-to-br ${item.color} hover:border-brand/40 transition-all duration-200`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-lg bg-neutral-900/80 group-hover:bg-brand/10 transition-colors">
                    <item.icon className="w-5 h-5 text-brand" />
                  </div>
                  <span className="font-semibold text-neutral-100">{item.label}</span>
                </div>
                <p className="text-xs text-neutral-500 pl-[44px]">{item.desc}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-neutral-700 group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
            </div>
          </button>
        ))}
      </div>

      {/* 状态区 */}
      <div className="mt-auto grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-neutral-600" />
            <span className="text-xs text-neutral-600">后端状态</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-green-400 animate-pulse' : backendStatus === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-sm font-medium text-neutral-300">
              {backendStatus === 'online' ? '在线' : backendStatus === 'checking' ? '检测中...' : '离线'}
            </span>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-neutral-600" />
            <span className="text-xs text-neutral-600">最近对话</span>
          </div>
          <span className="text-sm font-medium text-neutral-300">{chatHistory.length} 条消息</span>
        </div>
      </div>

      {/* 最近 AI 回复预览 */}
      {recentMsgs.length > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-neutral-900/40 border border-neutral-800/50">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-neutral-600" />
            <span className="text-xs text-neutral-600">最近 AI 回复</span>
          </div>
          <p className="text-xs text-neutral-500 line-clamp-2">{recentMsgs[recentMsgs.length - 1]?.content.slice(0, 120)}...</p>
        </div>
      )}
    </div>
  )
}

export function CommandCenter() {
  const { activeIntent } = useAppStore()
  const { setRightPanelOpen } = useUIStore()
  const [historyOpen, setHistoryOpen] = useState(false)

  // CommandCenter 自带右侧画布, 关闭 Shell 的 right panel 避免双重右栏
  useEffect(() => {
    setRightPanelOpen(false)
  }, [setRightPanelOpen])

  const renderRightPanel = () => {
    switch (activeIntent) {
      case 'generate_model':
        return <ModelGeneratorPanel />
      case 'deploy_s2b2c':
        return <S2B2CDeployPanel />
      case 'marketing_sop':
        return <MarketingSOPPanel />
      default:
        return <DefaultDashboard />
    }
  }

  return (
    <div className="flex h-full w-full bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* P3: 写操作确认门（全局浮层） */}
      <ConfirmationGate />

      {/* 左侧 LUI：对话历史 + 智能对话中枢 */}
      <div className="h-full border-r border-neutral-800 bg-neutral-900/50 backdrop-blur-xl flex flex-row overflow-hidden" style={{ width: historyOpen ? 'calc(35% + 260px)' : '35%', minWidth: historyOpen ? '580px' : '320px' }}>
        {/* 对话历史侧边栏 */}
        <ConversationHistory open={historyOpen} onToggle={() => setHistoryOpen(!historyOpen)} />

        {/* 对话中枢 */}
        <div className="flex-1 h-full min-w-0">
          <ChatCopilot onToggleHistory={() => setHistoryOpen(!historyOpen)} historyOpen={historyOpen} />
        </div>
      </div>

      {/* 右侧 GUI：动态渲染画布 (65%) */}
      <div className="flex-1 h-full relative overflow-hidden bg-neutral-950">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeIntent}
            initial={{ opacity: 0, x: 20, filter: 'blur(10px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: -20, filter: 'blur(10px)' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="w-full h-full p-8 overflow-y-auto"
          >
            {renderRightPanel()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
