// apps/web/src/main.tsx · v0.3 — WORKING: 完整路由修复
import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter, Outlet } from '@tanstack/react-router'
import { createRootRoute, createRoute } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import './styles/globals.css'
import './i18n'
import { queryClient } from './lib/query'

// 已验证: 直接 import 这些屏幕不会触发 require() 错误
import { Shell } from '@/screens/Shell'
import { CommandCenter } from '@/screens/CommandCenter'
import { Login } from '@/screens/Login'
import { Chat } from '@/screens/Chat'
import { AgentMarket } from '@/screens/AgentMarket'
import { Studio } from '@/screens/Studio'
import { FileBrowser } from '@/screens/FileBrowser'
import { McpManager } from '@/screens/McpManager'
import { Settings } from '@/screens/Settings'
import { SkillDetail } from '@/screens/SkillDetail'
import { ErrorPage } from '@/screens/ErrorPage'
import { SocialCookiesPage } from '@/routes/_workspace.settings.social-cookies'
import { AutomationPage } from '@/routes/_workspace.settings.automations'
import { MemoryPage } from '@/routes/_workspace.settings.memory'
import { LearningsPage } from '@/routes/_workspace.settings.learnings'
import { Documents } from '@/routes/_workspace.documents'
import { VisualizationsPage } from '@/routes/_workspace.visualizations'
import { DiagnosticsPage } from '@/routes/_workspace.diagnostics'  // D2 · 仿 Hermes doctor (2026-06-17)
import { OAuthManager } from '@/screens/OAuthManager'  // D6-3 (2026-06-18) 4 平台 OAuth 管理页
import { SkillsMarket } from '@/screens/SkillsMarket'
import { Workflows } from '@/screens/Workflows'

// ---- 路由树 ----
const rootRoute = createRootRoute({
  component: () => React.createElement(Outlet),
})

const wsLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: '_workspace',
  component: () => React.createElement(Shell, null, React.createElement(Outlet)),
})

const wsIndex = createRoute({ getParentRoute: () => wsLayout, path: '/', component: () => React.createElement(CommandCenter) })
const wsAgents = createRoute({ getParentRoute: () => wsLayout, path: '/agents', component: () => React.createElement(AgentMarket) })
const wsChat = createRoute({ getParentRoute: () => wsLayout, path: '/chats/$id', component: () => React.createElement(Chat) })
const wsStudio = createRoute({ getParentRoute: () => wsLayout, path: '/studio', component: () => React.createElement(Studio) })
const wsFiles = createRoute({ getParentRoute: () => wsLayout, path: '/files', component: () => React.createElement(FileBrowser) })
const wsMcp = createRoute({ getParentRoute: () => wsLayout, path: '/mcp', component: () => React.createElement(McpManager) })
const wsSettings = createRoute({ getParentRoute: () => wsLayout, path: '/settings', component: () => React.createElement(Settings) })
const wsSocialCookies = createRoute({ getParentRoute: () => wsLayout, path: '/settings/social-cookies', component: () => React.createElement(SocialCookiesPage) })
const wsAutomations = createRoute({ getParentRoute: () => wsLayout, path: '/settings/automations', component: () => React.createElement(AutomationPage) })
const wsMemory = createRoute({ getParentRoute: () => wsLayout, path: '/settings/memory', component: () => React.createElement(MemoryPage) })
const wsLearnings = createRoute({ getParentRoute: () => wsLayout, path: '/settings/learnings', component: () => React.createElement(LearningsPage) })
const wsSkills = createRoute({ getParentRoute: () => wsLayout, path: '/skills', component: () => React.createElement(SkillsMarket) })
const wsSkill = createRoute({ getParentRoute: () => wsLayout, path: '/skills/$id', component: () => React.createElement(SkillDetail) })
const wsDocuments = createRoute({ getParentRoute: () => wsLayout, path: '/documents', component: () => React.createElement(Documents) })
const wsVisualizations = createRoute({ getParentRoute: () => wsLayout, path: '/visualizations', component: () => React.createElement(VisualizationsPage) })
const wsWorkflows = createRoute({ getParentRoute: () => wsLayout, path: '/workflows', component: () => React.createElement(Workflows) })
const wsDiagnostics = createRoute({ getParentRoute: () => wsLayout, path: '/diagnostics', component: () => React.createElement(DiagnosticsPage) })  // D2 · 仿 Hermes doctor (2026-06-17)
const wsOAuth = createRoute({ getParentRoute: () => wsLayout, path: '/settings/oauth', component: () => React.createElement(OAuthManager) })  // D6-3 (2026-06-18) 4 平台 OAuth 管理页

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => React.createElement(Login) })
const errorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/error/$code', component: () => React.createElement(ErrorPage) })

const routeTree = rootRoute.addChildren([
  wsLayout.addChildren([wsIndex, wsAgents, wsChat, wsStudio, wsFiles, wsMcp, wsSettings, wsSocialCookies, wsAutomations, wsMemory, wsLearnings, wsSkills, wsSkill, wsDocuments, wsVisualizations, wsWorkflows, wsDiagnostics, wsOAuth]),
  loginRoute,
  errorRoute,
])
const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(
  React.createElement(StrictMode, null,
    React.createElement(ThemeProvider, { attribute: 'class', defaultTheme: 'dark', enableSystem: true },
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(RouterProvider, { router })
      )
    )
  )
)
