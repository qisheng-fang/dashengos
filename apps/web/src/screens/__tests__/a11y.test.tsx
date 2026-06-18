// apps/web/src/screens/__tests__/a11y.test.tsx · v0.3 PR7
// 跑 axe-core 检测所有 9 屏 (workspace + login + error) 的 critical/serious 违规
// jsdom 不能算颜色对比, axe-helper 里关掉了 color-contrast
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { expectNoCriticalA11y } from '@/test-utils/axe'

// Mock TanStack Router hooks (jsdom 测不动真路由)
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'c-001' }),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => () => {},
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { Login } from '@/screens/Login'
import { Workspace } from '@/screens/Workspace'
import { Chat } from '@/screens/Chat'
import { AgentMarket } from '@/screens/AgentMarket'
import { McpManager } from '@/screens/McpManager'
import { FileBrowser } from '@/screens/FileBrowser'
import { Settings } from '@/screens/Settings'
import { ErrorPage } from '@/screens/ErrorPage'
import { Shell } from '@/screens/Shell'

describe('PR7 · a11y critical/serious violations = 0', () => {
  it('Login screen', async () => {
    const { container } = render(<Login />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('Workspace screen', async () => {
    const { container } = render(<Workspace />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('Chat screen (id=c-001)', async () => {
    const { container } = render(<Chat />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('AgentMarket screen', async () => {
    const { container } = render(<AgentMarket />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('McpManager screen', async () => {
    const { container } = render(<McpManager />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('FileBrowser screen', async () => {
    const { container } = render(<FileBrowser />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('Settings screen', async () => {
    const { container } = render(<Settings />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('ErrorPage 404', async () => {
    // ErrorPage 用 useParams, mock 已经返回 {id: 'c-001'}, 这里直接渲染 with code prop
    const { container } = render(<ErrorPage />)
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })

  it('Shell (top nav + sidebar)', async () => {
    const { container } = render(
      <Shell>
        <div>main content</div>
      </Shell>,
    )
    const v = await expectNoCriticalA11y(container)
    expect(v.filter((x) => x.impact === 'critical' || x.impact === 'serious')).toHaveLength(0)
  })
})
