// screens/CommandCenter.tsx · LUI + GUI 双栏主布局
// ----------------------------------------------------------------------
// 左 35%: ChatCopilot (对话中枢, 驱动意图)
// 右 65%: 动态画布 (根据 activeIntent 渲染对应面板, 默认显示仪表盘)
// framer-motion 做面板切换动画
// ----------------------------------------------------------------------

import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store/useAppStore'
import { useUIStore } from '@/store/ui'
import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import ChatCopilot from '@/components/ChatCopilot'
import ConversationHistory from '@/components/ConversationHistory'
import ConfirmationGate from '@/components/ConfirmationGate'  // P3 · 写操作确认门
import OutputGatewayMonitor from '@/components/OutputGatewayMonitor'  // Output Gateway 安全横幅
import ModelGeneratorPanel from '@/components/panels/ModelGeneratorPanel'
import S2B2CDeployPanel from '@/components/panels/S2B2CDeployPanel'
import MarketingSOPPanel from '@/components/panels/MarketingSOPPanel'

/** 快捷意图入口 */


export function CommandCenter() {
  const { activeIntent } = useAppStore()
  const { setActiveIntent } = useAppStore()
  const { /* setRightPanelOpen */ } = useUIStore()
  const [historyOpen, setHistoryOpen] = useState(false)
  const location = useLocation()

  // 2026-06-20: 仪表盘已移到左侧栏，保留 Shell RightPanel 作预览
  // 2026-06-20: 导航切换时恢复全宽聊天
  useEffect(() => {
    setActiveIntent('idle')
  }, [location.pathname, setActiveIntent])

  const hasActiveIntent = activeIntent && activeIntent !== null
  const showRightPanel = hasActiveIntent

  const renderRightPanel = () => {
    switch (activeIntent) {
      case 'generate_model':
        return <ModelGeneratorPanel />
      case 'deploy_s2b2c':
        return <S2B2CDeployPanel />
      case 'marketing_sop':
        return <MarketingSOPPanel />
      default:
        return null
    }
  }

  return (
    <div className="flex h-full w-full bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* P3: 写操作确认门（全局浮层） */}
      <ConfirmationGate />

      {/* Output Gateway: 安全输出过滤器状态监控 */}
      <OutputGatewayMonitor />

      {/* 左侧 LUI：对话中枢 */}
      <div className={`h-full bg-neutral-900/50 backdrop-blur-xl flex flex-row overflow-hidden transition-all duration-300 ${
        showRightPanel ? 'border-r border-neutral-800' : ''
      }`} style={{ 
        width: showRightPanel 
          ? historyOpen ? 'calc(35% + 260px)' : '35%'
          : '100%',
        minWidth: showRightPanel ? (historyOpen ? '580px' : '320px') : '0'
      }}>
        {/* 对话历史侧边栏 */}
        <ConversationHistory open={historyOpen} onToggle={() => setHistoryOpen(!historyOpen)} />

        {/* 对话中枢 */}
        <div className="flex-1 h-full min-w-0">
          <ChatCopilot onToggleHistory={() => setHistoryOpen(!historyOpen)} historyOpen={historyOpen} />
        </div>
      </div>

      {/* 右侧 GUI：动态渲染画布 (仅当有 activeIntent 时) */}
      {showRightPanel && (
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
      )}
    </div>
  )
}
