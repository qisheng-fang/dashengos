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
import { DiagnosticsPage } from '@/routes/_workspace.diagnostics'  // D2 · 仿 Hermes doctor (2026-06-17)
import { OAuthManager } from '@/screens/OAuthManager'  // D6-3 (2026-06-18) 4 平台 OAuth 管理页
import { SkillsMarket } from '@/screens/SkillsMarket'
import { BrowserAutomation } from '@/screens/BrowserAutomation'
// P0-fix: Workflows 组件由 Studio 页面内部引用，不再直接用于 /workflows 路由
// import { Workflows } from '@/screens/Workflows'
import { ModelsLayout } from '@/routes/_workspace.settings.models'
import { TextModelsPage } from '@/routes/_workspace.settings.models.text'
import { MultimodalModelsPage } from '@/routes/_workspace.settings.models.multimodal'
import { ProviderPage } from '@/routes/_workspace.settings.models.provider'
import { CustomModelManager } from '@/screens/CustomModelManager'  // 自定义模型管理页 (2026-06-19)
import { Agents } from '@/screens/Agents'
import { Documents } from '@/screens/Documents'
import { TeamDashboard } from '@/screens/TeamDashboard'
import { Visualizations } from '@/screens/Visualizations'
import { AgentTARS } from "@/screens/AgentTARS"
import { AstrBot } from "@/screens/AstrBot"
import { LangGraph } from "@/screens/LangGraph"
import { Transformers } from "@/screens/Transformers"
import { OpenDesign } from "@/screens/OpenDesign"
import { OpenMontage } from "@/screens/OpenMontage"
import { AdminPage } from '@/routes/_workspace.settings.admin'
import { HealthDashboard } from '@/screens/HealthDashboard'
import { TerminalPage } from '@/routes/_workspace.terminal'

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
const wsChat = createRoute({ getParentRoute: () => wsLayout, path: '/chats/$id', component: () => React.createElement(Chat) })
const wsStudio = createRoute({ getParentRoute: () => wsLayout, path: '/studio', component: () => React.createElement(Studio) })
const wsOpenDesign = createRoute({ getParentRoute: () => wsLayout, path: "/open-design", component: () => React.createElement(OpenDesign) })
const wsOpenMontage = createRoute({ getParentRoute: () => wsLayout, path: "/openmontage", component: () => React.createElement(OpenMontage) })
const wsFiles = createRoute({ getParentRoute: () => wsLayout, path: '/files', component: () => React.createElement(FileBrowser) })
const wsMcp = createRoute({ getParentRoute: () => wsLayout, path: '/mcp', component: () => React.createElement(McpManager) })
const wsSettings = createRoute({ getParentRoute: () => wsLayout, path: '/settings', component: () => React.createElement(Settings) })
const wsSocialCookies = createRoute({ getParentRoute: () => wsSettings, path: 'social-cookies', component: () => React.createElement(SocialCookiesPage) })
const wsAutomations = createRoute({ getParentRoute: () => wsSettings, path: 'automations', component: () => React.createElement(AutomationPage) })
const wsMemory = createRoute({ getParentRoute: () => wsSettings, path: 'memory', component: () => React.createElement(MemoryPage) })
const wsLearnings = createRoute({ getParentRoute: () => wsSettings, path: 'learnings', component: () => React.createElement(LearningsPage) })
const wsSkills = createRoute({ getParentRoute: () => wsLayout, path: '/skills', component: () => React.createElement(SkillsMarket) })
const wsBrowser = createRoute({ getParentRoute: () => wsLayout, path: '/browser', component: () => React.createElement(BrowserAutomation) })
const wsSkill = createRoute({ getParentRoute: () => wsLayout, path: '/skills/$id', component: () => React.createElement(SkillDetail) })
const wsAstrBot = createRoute({ getParentRoute: () => wsLayout, path: "/astrbot", component: () => React.createElement(AstrBot) })
const wsLangGraph = createRoute({ getParentRoute: () => wsLayout, path: "/langgraph", component: () => React.createElement(LangGraph) })
const wsTransformers = createRoute({ getParentRoute: () => wsLayout, path: "/transformers", component: () => React.createElement(Transformers) })
const wsAgentTARS = createRoute({ getParentRoute: () => wsLayout, path: "/agent-tars", component: () => React.createElement(AgentTARS) })
const wsAgents = createRoute({ getParentRoute: () => wsLayout, path: '/agents', component: () => React.createElement(Agents) })
const wsDocuments = createRoute({ getParentRoute: () => wsLayout, path: '/documents', component: () => React.createElement(Documents) })
const wsTeam = createRoute({ getParentRoute: () => wsLayout, path: '/team', component: () => React.createElement(TeamDashboard) })
const wsAutomationsTop = createRoute({ getParentRoute: () => wsLayout, path: '/automations', component: () => React.createElement(AutomationPage) })
const wsVisualizations = createRoute({ getParentRoute: () => wsLayout, path: '/visualizations', component: () => React.createElement(Visualizations) })

const wsHealth = createRoute({ getParentRoute: () => wsLayout, path: '/health', component: () => React.createElement(HealthDashboard) })
const wsTerminal = createRoute({ getParentRoute: () => wsLayout, path: '/terminal', component: () => React.createElement(TerminalPage) })
const wsWorkflows = createRoute({
  getParentRoute: () => wsLayout,
  path: '/workflows',
  // P0-fix (2026-06-18): /workflows 重定向到 /studio (Studio 页面内集成模板 Tab)

  component: () => React.createElement(Studio),
})
const wsDiagnostics = createRoute({ getParentRoute: () => wsSettings, path: 'diagnostics', component: () => React.createElement(DiagnosticsPage) })  // D2 · 仿 Hermes doctor (2026-06-17) — P1-fix: 移入 Settings 子路由 /settings/diagnostics
const wsOAuth = createRoute({ getParentRoute: () => wsSettings, path: 'oauth', component: () => React.createElement(OAuthManager) })  // D6-3 (2026-06-18) 4 平台 OAuth 管理页
const wsModels = createRoute({ getParentRoute: () => wsSettings, path: 'models', component: () => React.createElement(ModelsLayout) })
const wsModelsText = createRoute({ getParentRoute: () => wsModels, path: 'text', component: () => React.createElement(TextModelsPage) })
const wsModelsMultimodal = createRoute({ getParentRoute: () => wsModels, path: 'multimodal', component: () => React.createElement(MultimodalModelsPage) })
const wsModelsProvider = createRoute({ getParentRoute: () => wsModels, path: 'provider', component: () => React.createElement(ProviderPage) })
const wsModelsCustom = createRoute({ getParentRoute: () => wsModels, path: 'custom', component: () => React.createElement(CustomModelManager) })  // 自定义模型 CRUD (2026-06-19)
const wsAdmin = createRoute({ getParentRoute: () => wsSettings, path: 'admin', component: () => React.createElement(AdminPage) })

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => React.createElement(Login) })
const errorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/error/$code', component: () => React.createElement(ErrorPage) })

const routeTree = rootRoute.addChildren([
  wsLayout.addChildren([wsIndex, wsAgents, wsChat, wsStudio, wsFiles, wsMcp, wsHealth, wsAutomationsTop, wsSettings, wsSocialCookies, wsAutomations, wsMemory, wsLearnings, wsSkills, wsBrowser, wsSkill, wsDocuments, wsTeam, wsVisualizations, wsAgentTARS, wsAstrBot, wsLangGraph, wsTransformers, wsOpenDesign, wsOpenMontage, wsTerminal, wsWorkflows, wsDiagnostics, wsOAuth, wsModels, wsModelsText, wsModelsMultimodal, wsModelsProvider, wsModelsCustom, wsAdmin]),
  loginRoute,
  errorRoute,
])
const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(
  React.createElement(React.Fragment, null,
    React.createElement(ThemeProvider, { attribute: 'class', defaultTheme: 'dark', enableSystem: true },
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(RouterProvider, { router })
      )
    )
  )
)
