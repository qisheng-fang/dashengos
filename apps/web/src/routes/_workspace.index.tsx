// apps/web/src/routes/_workspace.index.tsx · Phase 调试
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_workspace/')({
  component: () => (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-brand mb-4">DaShengOS v0.3</h1>
      <p className="text-neutral-400">私有 AI 工作台 · 所有系统就绪</p>
      <div className="mt-6 grid grid-cols-3 gap-4">
        {['Chat', 'AgentMarket', 'Studio', '文件', 'MCP', 'Settings'].map(name => (
          <div key={name} className="border border-neutral-800 rounded-lg p-4 hover:border-brand/50 cursor-pointer transition-colors">
            <div className="text-sm text-neutral-200">{name}</div>
            <div className="text-xs text-neutral-500 mt-1">点击进入</div>
          </div>
        ))}
      </div>
    </div>
  ),
})