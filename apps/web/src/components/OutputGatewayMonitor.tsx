// OutputGatewayMonitor.tsx — 网关状态实时监控
// 监听 SSE 事件中的 gateway 拦截，弹出横幅提示
import { useEffect, useState } from 'react'
import OutputGatewayBanner, { type GatewayStatus } from './OutputGatewayBanner'

export default function OutputGatewayMonitor() {
  const [events, setEvents] = useState<Array<{ id: string; status: GatewayStatus; ts: number }>>([])

  useEffect(() => {
    // Listen for custom gateway events broadcast from SSE handlers
    const handler = (e: CustomEvent<GatewayStatus>) => {
      const id = crypto.randomUUID?.() || Math.random().toString(36)
      setEvents(prev => [...prev.slice(-5), { id, status: e.detail, ts: Date.now() }])
      // Auto-dismiss after 10s
      setTimeout(() => {
        setEvents(prev => prev.filter(evt => evt.id !== id))
      }, 10000)
    }
    window.addEventListener('dasheng:gateway-status' as any, handler as any)
    return () => window.removeEventListener('dasheng:gateway-status' as any, handler as any)
  }, [])

  if (events.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] space-y-2 max-w-sm">
      {events.map(evt => (
        <OutputGatewayBanner key={evt.id} status={evt.status} />
      ))}
    </div>
  )
}
