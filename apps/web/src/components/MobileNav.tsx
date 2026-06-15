// apps/web/src/components/MobileNav.tsx · v0.3 Phase 5 收官
// 移动端底部 3-tab nav (Workspace / Agents / Settings)
// 用 useIsMobile 判断显示
import { Link, useLocation } from '@tanstack/react-router'
import { Home, Store, Settings as SettingsIcon } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'

const TABS = [
  { to: '/', icon: Home, label: '工作台' },
  { to: '/agents', icon: Store, label: '市场' },
  { to: '/settings', icon: SettingsIcon, label: '设置' },
] as const

export function MobileNav() {
  const isMobile = useIsMobile()
  const location = useLocation()
  if (!isMobile) return null
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-neutral-950 border-t border-neutral-800 flex items-center justify-around h-14"
      aria-label="底部导航"
    >
      {TABS.map((tab) => {
        const active =
          location.pathname === tab.to ||
          (tab.to !== '/' && location.pathname.startsWith(tab.to))
        const Icon = tab.icon
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 text-xs ${
              active ? 'text-brand' : 'text-neutral-400'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
