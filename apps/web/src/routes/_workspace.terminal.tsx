// DaShengOS Terminal Route
import { createFileRoute } from '@tanstack/react-router'
import { Terminal } from '@/components/Terminal'

export const Route = createFileRoute('/_workspace/terminal')({
  component: TerminalPage,
})

export function TerminalPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-sm font-medium text-neutral-200">终端</span>
        <span className="text-xs text-neutral-500 ml-auto">DaShengOS Terminal · bash/zsh</span>
      </div>
      <div className="flex-1 p-2">
        <Terminal className="h-full rounded-lg overflow-hidden border border-neutral-800" />
      </div>
    </div>
  )
}
