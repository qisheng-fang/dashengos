# DaShengOS v0.3 → 对齐 Hermes · 落地执行方案 v1

> **作者**：WorkBuddy (Deepseek-V4-Pro)
> **日期**：2026-06-17 23:34
> **触发**：老板要"按表对齐 + 给执行方案 + 按方案执行"
> **总工期**：3 周（含 1 周 review / 修 bug）
> **目标**：把表里 11 个差距项全部消除，让 DaShengOS 体验对齐 Hermes

---

## 一、11 个差距项 → 6 个交付块

| 表里差距 | 交付块 | 工期 | 老板能看到什么 |
|---|---|---|---|
| 状态色 + 重启操作 + 状态 API 11 字段缺失 | **D1 状态条 + 重启系统** | 1 天 | 底部色块 + 1 按钮 |
| Doctor 自检 0 | **D2 Doctor 自检** | 2 天 | `/diagnostics` 子页 + 14 章节 |
| Provider 29 vs 3 | **D3 Provider 插件化** | 5 天 | 加 provider = 丢 1 个目录 |
| 模型目录写死 | **D3.2 远程模型目录** | 1 天 | `/api/model/options` 动态拉取 |
| 凭证轮换 0 | **D3.3 凭证池** | 1 天 | 同 provider 多 key 自动轮换 |
| OAuth 登录 0 | **D4 OAuth 登录** | 3 天 | Anthropic / Qwen / OpenAI Codex |
| 配置分层 1 文件 | **D5 配置/凭证分层** | 3 天 | `~/.dasheng/{config.yaml,.env,auth.json}` + 热重载 |
| Web Server 散 | **D6 Web Server 整合** | 2 天 | 拆 2500 行 → 8 模块文件 |
| Provider 29-3=26 个空缺 | **D7 补 26 个 provider** | 1 周 | 全部对齐 Hermes provider 目录 |

**总工期 = 1+2+5+1+1+3+3+2+7 = 25 天 ≈ 3.5 周**

---

## 二、详细执行方案

### D1 状态条 + 重启系统（**1 天**）

**目标**：底部 1 色块 + 1 按钮 + 1 状态行

#### D1.1 后端：`packages/backend/src/api/status.ts`（新增 100 行）

```typescript
import type { FastifyInstance } from 'fastify'
import { existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { db } from '../storage/db.js'

function checkPort(port: number): boolean {
  try { return !!execSync(`lsof -ti:${port}`, { stdio: 'pipe' }).toString().trim() }
  catch { return false }
}

function checkSocket(path: string): boolean {
  return existsSync(path)
}

function checkPythonDep(dep: string): { installed: boolean; version?: string } {
  try {
    const v = execSync(`/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3 -c "import ${dep}; print(getattr(${dep}, '__version__', 'unknown'))"`, { stdio: 'pipe', timeout: 5000 }).toString().trim()
    return { installed: true, version: v }
  } catch { return { installed: false } }
}

export async function statusRoutes(app: FastifyInstance) {
  app.get('/api/status', async () => {
    const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c
    const messageCount = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
    const docCount = (db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number }).c

    return {
      version: '0.3.0',
      uptime_sec: process.uptime(),
      backend: { running: true, port: 8000, host: '127.0.0.1' },
      gateway: {
        running: checkSocket('/tmp/dasheng/deerflow.sock'),
        socket: '/tmp/dasheng/deerflow.sock',
        state: checkSocket('/tmp/dasheng/deerflow.sock') ? 'running' : 'stopped',
      },
      services: {
        vite: { running: checkPort(3000), port: 3000 },
        fastify: { running: checkPort(8000), port: 8000 },
      },
      providers: {
        siliconflow: { configured: !!process.env.SILICONFLOW_API_KEY, model: 'Qwen/Qwen2.5-72B-Instruct' },
        deepseek:    { configured: !!process.env.DEEPSEEK_API_KEY,    model: 'deepseek-chat' },
        ollama:      { configured: !!process.env.OLLAMA_HOST,         model: 'qwen2.5:7b' },
      },
      python_deps: {
        'python-docx': checkPythonDep('docx'),
        'python-pptx': checkPythonDep('pptx'),
        'weasyprint':  checkPythonDep('weasyprint'),
        'openpyxl':    checkPythonDep('openpyxl'),
        'playwright':  checkPythonDep('playwright'),
      },
      db: { path: './data/dasheng.db', sessions: sessionCount, messages: messageCount, documents: docCount },
      storage: { docs_dir_writable: existsSync('/tmp/dasheng-docs') },
    }
  })

  app.post('/api/system/restart-gateway', async () => {
    try {
      execSync('pkill -f deerflow.daemon || true', { stdio: 'ignore' })
      await new Promise(r => setTimeout(r, 1000))
      execSync('nohup /Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3 -m deerflow.daemon > /tmp/dasheng/deerflow.log 2>&1 &', { stdio: 'ignore', cwd: '/Users/apple/Desktop/ai-workbench-v2' })
      return { ok: true, message: 'DeerFlow daemon 重启中...' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })
}
```

#### D1.2 前端：`apps/web/src/components/SidebarStatusStrip.tsx`（新增 80 行）

```typescript
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/api'
import { Loader2, RefreshCw, CheckCircle2, AlertCircle, Cpu } from 'lucide-react'

interface Status {
  backend: { running: boolean; port: number }
  gateway: { running: boolean; state: 'running' | 'starting' | 'stopped' | 'failed' }
  providers: Record<string, { configured: boolean; model: string }>
  python_deps: Record<string, { installed: boolean; version?: string }>
  db: { sessions: number; messages: number; documents: number }
}

export function SidebarStatusStrip() {
  const qc = useQueryClient()
  const { data: status } = useQuery<Status>({
    queryKey: ['status'],
    queryFn: () => http.get('/api/status'),
    refetchInterval: 10_000,
  })

  const [restarting, setRestarting] = useState(false)
  const handleRestart = async () => {
    setRestarting(true)
    try {
      await http.post('/api/system/restart-gateway')
      await new Promise(r => setTimeout(r, 3000))
      qc.invalidateQueries({ queryKey: ['status'] })
    } finally {
      setRestarting(false)
    }
  }

  if (!status) return <div className="border-t border-neutral-800 px-3 py-3 text-xs text-neutral-500"><Loader2 size={10} className="inline animate-spin" /> 检测中...</div>

  const gatewayOk = status.gateway.running
  const providerCount = Object.values(status.providers).filter(p => p.configured).length
  const providerTotal = Object.keys(status.providers).length
  const missingDeps = Object.entries(status.python_deps).filter(([_, v]) => !v.installed).map(([k]) => k)

  return (
    <div className="border-t border-neutral-800 px-3 py-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${gatewayOk ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
        <span className="text-neutral-300 flex-1">
          {gatewayOk ? 'AI 引擎在线' : 'AI 引擎离线'}
        </span>
        <span className="text-neutral-500">{status.db.sessions} 会话</span>
      </div>
      <div className="flex items-center gap-3 text-neutral-500 text-[10px]">
        <span><Cpu size={9} className="inline mr-1" />{providerCount}/{providerTotal} 模型</span>
        <span>📊 {status.db.messages} 消息</span>
      </div>
      {missingDeps.length > 0 && (
        <div className="text-yellow-400 text-[10px]">
          ⚠️ 缺 {missingDeps.length} 个依赖
        </div>
      )}
      <button
        onClick={handleRestart}
        disabled={restarting}
        className="w-full text-[10px] text-neutral-400 hover:text-brand py-1.5 border border-neutral-800 rounded flex items-center justify-center gap-1 disabled:opacity-50"
      >
        {restarting ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        {restarting ? '重启中...' : '重启 AI 引擎'}
      </button>
    </div>
  )
}
```

#### D1.3 Shell.tsx 集成（改 3 行）

```typescript
// apps/web/src/screens/Shell.tsx
import { SidebarStatusStrip } from '@/components/SidebarStatusStrip'
// ...
// 在侧栏底部 <aside> 内、SidebarFooter 之前加：
<SidebarStatusStrip />
```

#### D1.4 server.ts 注册路由（改 2 行）

```typescript
// packages/backend/src/server.ts
import { statusRoutes } from './api/status.js'
// ...
await app.register(statusRoutes)
```

#### D1.5 验收标准
- ✅ 进 UI 看到底部 1 色块（绿/红）
- ✅ 色块 10s 自动刷新
- ✅ 点"重启 AI 引擎"3 秒后状态变绿
- ✅ 后端日志看到 "GET /api/status" 请求

---

### D2 Doctor 自检（**2 天**）

**目标**：`GET /api/doctor` 返回 14 章节 + 前端 `/diagnostics` 子页

#### D2.1 后端：`packages/backend/src/api/doctor.ts`（新增 200 行）

```typescript
import type { FastifyInstance } from 'fastify'
import { execSync, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { db } from '../storage/db.js'

type CheckStatus = 'ok' | 'warn' | 'fail' | 'info'
interface Check { status: CheckStatus; text: string; detail?: string; fix?: string }
interface Section { name: string; checks: Check[] }

function ok(text: string, detail?: string): Check { return { status: 'ok', text, detail } }
function warn(text: string, detail?: string, fix?: string): Check { return { status: 'warn', text, detail, fix } }
function fail(text: string, detail?: string, fix?: string): Check { return { status: 'fail', text, detail, fix } }
function info(text: string, detail?: string): Check { return { status: 'info', text, detail } }

const PYTHON = '/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3'

function checkPythonDep(dep: string): Check {
  try {
    const v = execSync(`${PYTHON} -c "import ${dep}; print(getattr(${dep}, '__version__', '?'))"`, { stdio: 'pipe', timeout: 5000 }).toString().trim()
    return ok(`${dep}`, v)
  } catch {
    return fail(`${dep} not installed`, undefined, `${PYTHON.replace('/python3', '/pip')} install ${dep}`)
  }
}

function checkPort(port: number, expected: boolean): Check {
  try {
    const out = execSync(`lsof -ti:${port}`, { stdio: 'pipe' }).toString().trim()
    const isUp = !!out
    if (isUp === expected) return ok(`Port :${port}`, expected ? 'running' : 'free')
    return warn(`Port :${port}`, isUp ? 'unexpectedly in use' : 'not listening')
  } catch { return expected ? fail(`Port :${port}`, 'not listening') : ok(`Port :${port}`, 'free') }
}

function checkSocket(path: string): Check {
  if (existsSync(path)) return ok(`Socket ${path}`, 'alive')
  return fail(`Socket ${path}`, 'not found', 'POST /api/system/restart-gateway')
}

function checkDir(path: string, mustWritable = true): Check {
  if (!existsSync(path)) return fail(`Dir ${path}`, 'not exists', `mkdir -p ${path}`)
  if (!mustWritable) return ok(`Dir ${path}`)
  try { execSync(`test -w ${path}`); return ok(`Dir ${path}`, 'writable') }
  catch { return fail(`Dir ${path}`, 'not writable', `chmod 755 ${path}`) }
}

export async function doctorRoutes(app: FastifyInstance) {
  app.get('/api/doctor', async () => {
    const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c
    const messageCount = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as any).c
    const skInstalls = (db.prepare('SELECT COUNT(*) as c FROM skill_installs').get() as any).c

    const sections: Section[] = [
      {
        name: 'Python Environment',
        checks: [
          (() => {
            try {
              const v = execSync(`${PYTHON} --version`, { stdio: 'pipe' }).toString().trim()
              return ok(v, 'agent/.venv')
            } catch { return fail('Python not found', undefined, `${PYTHON}`) }
          })(),
        ]
      },
      {
        name: 'Required Packages',
        checks: [
          checkPythonDep('docx'),
          checkPythonDep('pptx'),
          checkPythonDep('openpyxl'),
          checkPythonDep('weasyprint'),
          checkPythonDep('playwright'),
        ]
      },
      {
        name: 'LLM Providers',
        checks: [
          process.env.SILICONFLOW_API_KEY
            ? ok('SiliconFlow', `Qwen/Qwen2.5-72B-Instruct · ${process.env.SILICONFLOW_API_KEY.slice(0, 6)}...`)
            : warn('SiliconFlow', 'API key missing', 'export SILICONFLOW_API_KEY=sk-...'),
          process.env.DEEPSEEK_API_KEY
            ? ok('DeepSeek', 'configured')
            : info('DeepSeek', 'not configured (optional)'),
          process.env.OLLAMA_HOST
            ? ok('Ollama', process.env.OLLAMA_HOST)
            : info('Ollama', 'not configured (optional)'),
        ]
      },
      {
        name: 'Backend Services',
        checks: [
          checkPort(8000, true),  // Fastify should be up
          checkPort(3000, true),  // Vite should be up
          checkSocket('/tmp/dasheng/deerflow.sock'),
        ]
      },
      {
        name: 'Data',
        checks: [
          ok('SQLite DB', 'connected'),
          info(`Sessions: ${sessionCount}`),
          info(`Messages: ${messageCount}`),
          info(`Skill installs: ${skInstalls}`),
          messageCount === 0 && sessionCount > 0
            ? warn('对话未持久化', `${sessionCount} sessions / 0 messages`, '检查 chat.ts 是否调用 db.prepare(INSERT INTO messages...)')
            : messageCount > 0
              ? ok(`对话持久化`, `${messageCount} messages stored`)
              : info('对话持久化', 'no data yet'),
        ]
      },
      {
        name: 'Browser Automation',
        checks: [
          checkPythonDep('playwright'),
          (() => {
            try {
              const out = execSync(`${PYTHON} -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); print('chromium:', 'installed' if p.chromium.executable_path else 'missing'); p.stop()"`, { stdio: 'pipe', timeout: 10000 }).toString().trim()
              return ok('Playwright Chromium', out)
            } catch { return warn('Playwright Chromium', 'not installed', `${PYTHON} -m playwright install chromium`) }
          })(),
        ]
      },
      {
        name: 'Storage',
        checks: [
          checkDir('/tmp/dasheng-docs'),
          checkDir('/tmp/dasheng'),
        ]
      },
      {
        name: 'Documentation',
        checks: [
          existsSync('/Users/apple/Desktop/ai-workbench-v2/STATUS.md') ? ok('STATUS.md') : fail('STATUS.md'),
          existsSync('/Users/apple/Desktop/ai-workbench-v2/DaShengOS-v0.3-生产就绪审计报告-2026-06-17.md') ? ok('生产审计报告') : info('生产审计报告 missing'),
        ]
      },
    ]

    const total = sections.reduce((sum, s) => sum + s.checks.length, 0)
    const pass = sections.reduce((sum, s) => sum + s.checks.filter(c => c.status === 'ok').length, 0)
    const failN = sections.reduce((sum, s) => sum + s.checks.filter(c => c.status === 'fail').length, 0)
    const warnN = sections.reduce((sum, s) => sum + s.checks.filter(c => c.status === 'warn').length, 0)

    return {
      summary: { total, pass, fail: failN, warn: warnN, healthy: failN === 0 },
      sections,
    }
  })
}
```

#### D2.2 前端：`apps/web/src/routes/_workspace.diagnostics.tsx`（新增 100 行）

```typescript
import { useQuery } from '@tanstack/react-query'
import { http } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'ok' | 'warn' | 'fail' | 'info'
interface Check { status: Status; text: string; detail?: string; fix?: string }
interface Section { name: string; checks: Check[] }

const iconMap: Record<Status, { icon: any; color: string; bg: string }> = {
  ok:   { icon: CheckCircle2, color: 'text-green-400',  bg: 'bg-green-500/10' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  fail: { icon: AlertCircle,    color: 'text-red-400',    bg: 'bg-red-500/10' },
  info: { icon: Info,           color: 'text-blue-400',   bg: 'bg-blue-500/10' },
}

export function DiagnosticsPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['doctor'],
    queryFn: () => http.get<{ summary: { total: number; pass: number; fail: number; warn: number; healthy: boolean }; sections: Section[] }>('/api/doctor'),
    refetchInterval: 30_000,
  })

  if (isLoading) return <div className="p-6 text-neutral-500"><Loader2 className="inline animate-spin" /> 扫描中...</div>
  if (!data) return null

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🔍 系统诊断</h1>
          <p className="text-sm text-neutral-400 mt-1">{data.summary.pass}/{data.summary.total} 项通过 · {data.summary.fail} 失败 · {data.summary.warn} 警告</p>
        </div>
        <button onClick={() => refetch()} className="text-sm text-brand hover:underline">🔄 重新扫描</button>
      </div>

      {!data.summary.healthy && (
        <Card className="p-4 border-red-500/50 bg-red-500/5">
          <div className="flex items-center gap-2 text-red-300">
            <AlertCircle size={16} />
            <span className="font-semibold">发现 {data.summary.fail} 项阻断</span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">修复后才能让所有功能正常工作</p>
        </Card>
      )}

      {data.sections.map(sec => (
        <Card key={sec.name} className="p-4">
          <h2 className="text-sm font-semibold text-neutral-300 mb-3">{sec.name}</h2>
          <div className="space-y-1">
            {sec.checks.map((c, i) => {
              const meta = iconMap[c.status]
              const Icon = meta.icon
              return (
                <div key={i} className={cn('flex items-start gap-2 p-2 rounded text-sm', meta.bg)}>
                  <Icon size={14} className={cn('mt-0.5 flex-shrink-0', meta.color)} />
                  <div className="flex-1">
                    <div className={cn('font-medium', meta.color)}>{c.text}</div>
                    {c.detail && <div className="text-xs text-neutral-500 mt-0.5">{c.detail}</div>}
                    {c.fix && <div className="text-xs text-neutral-400 mt-1 font-mono bg-neutral-900/50 px-2 py-1 rounded">$ {c.fix}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}
```

#### D2.3 注册路由（改 3 行）

```typescript
// apps/web/src/main.tsx 加
import { DiagnosticsPage } from './routes/_workspace.diagnostics'
// ...
{
  path: 'diagnostics',
  element: <DiagnosticsPage />,
},
```

```typescript
// apps/web/src/screens/Settings.tsx Sidebar 加一项
{ to: '/settings/diagnostics', icon: Stethoscope, label: '系统诊断' },
```

```typescript
// packages/backend/src/server.ts
import { doctorRoutes } from './api/doctor.js'
await app.register(doctorRoutes)
```

#### D2.4 验收标准
- ✅ 进 `/settings/diagnostics` 看到 8 章节
- ✅ 每章节用色块：🟢 ok / 🟡 warn / 🔴 fail
- ✅ fail/warn 项显示"修法"命令行
- ✅ "重新扫描"按钮可用
- ✅ Hermes 14 章节（我们先 8 个核心，下一阶段补齐 14）

---

### D3 Provider 插件化（**5 天**）

**目标**：29 个 provider 全部 plugin 化，新增 provider = 丢 1 个目录

#### D3.1 接口定义（1 天）：`packages/backend/src/providers/base.ts`

```typescript
export interface ChatRequest {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export interface ChatResponse {
  content: string
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string
}

export interface ProviderProfile {
  name: string
  displayName: string
  description: string
  signupUrl: string
  authType: 'api_key' | 'oauth' | 'aws_sdk' | 'none'
  envVars: string[]
  baseUrl: string
  modelsUrl?: string
  defaultHeaders?: Record<string, string>
  defaultModel: string
  fallbackModels: string[]
  supportsTools: boolean
  supportsVision: boolean
  contextWindow: number
  chat: (req: ChatRequest, apiKey: string) => Promise<ChatResponse>
  listModels: (apiKey: string) => Promise<string[]>
  test: (apiKey: string) => Promise<{ ok: boolean; latency_ms: number; error?: string }>
}
```

#### D3.2 自动扫描（1 天）：`packages/backend/src/providers/index.ts`

```typescript
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ProviderProfile } from './base.js'

const PROVIDERS = new Map<string, ProviderProfile>()

export function loadProviders() {
  if (PROVIDERS.size > 0) return PROVIDERS
  const dir = join(__dirname, 'plugins')
  if (!existsSync(dir)) return PROVIDERS
  for (const name of readdirSync(dir)) {
    const path = join(dir, name, 'provider.js')
    if (!existsSync(path)) continue
    try {
      const mod = require(path)
      const profile: ProviderProfile = mod.default || mod
      PROVIDERS.set(profile.name, profile)
    } catch (e) {
      console.warn(`[providers] failed to load ${name}:`, (e as Error).message)
    }
  }
  return PROVIDERS
}

export function getProvider(name: string): ProviderProfile | undefined {
  return loadProviders().get(name)
}

export function listProviders() {
  return Array.from(loadProviders().values()).map(p => ({
    name: p.name,
    displayName: p.displayName,
    authType: p.authType,
    configured: p.envVars.every(v => !!process.env[v]),
    model: p.defaultModel,
  }))
}

export function getActiveProvider(): ProviderProfile {
  const name = process.env.LLM_PROVIDER || 'siliconflow'
  const p = getProvider(name)
  if (!p) throw new Error(`Provider not found: ${name}. Available: ${Array.from(loadProviders().keys()).join(', ')}`)
  return p
}
```

#### D3.3 重写 3 个现有 provider（1 天）

`packages/backend/src/providers/plugins/siliconflow/provider.ts`
`packages/backend/src/providers/plugins/deepseek/provider.ts`
`packages/backend/src/providers/plugins/ollama/provider.ts`

每个 ~80 行，参考 Hermes `providers/plugins/anthropic/__init__.py` 风格。

#### D3.4 chat.ts 改用（半天）

```typescript
// 删掉 100+ 行 hardcode LLM 调用，换成：
import { getActiveProvider } from '../providers/index.js'
// ...
async function directLLM(message: string, history: any[]) {
  const provider = getActiveProvider()
  const apiKey = process.env[provider.envVars[0]] || ''
  if (provider.authType === 'api_key' && !apiKey) {
    throw new Error(`[${provider.name}] ${provider.envVars[0]} 未配置`)
  }
  // ... messages / system prompt 保留 ...
  return provider.chat({ model: provider.defaultModel, messages }, apiKey)
}
```

#### D3.5 验收标准
- ✅ `GET /api/providers` 列出 3 个 provider
- ✅ 改 `LLM_PROVIDER=ollama` 重启后自动切到 Ollama
- ✅ 删一个 provider 目录（备份后）→ `/api/providers` 不再列它
- ✅ Hermes 风格：丢 `providers/plugins/qwen/` 目录 → 不用改任何代码就生效

#### D3.6 远程模型目录（1 天）：`packages/backend/src/providers/model-catalog.ts`

```typescript
const CATALOG_URL = 'https://hermes.nousresearch.com/docs/api/model-catalog.json'  // 借用 Hermes
const TTL_MS = 24 * 60 * 60 * 1000
let cache: { ts: number; data: any } | null = null

export async function fetchModelCatalog(): Promise<any> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data
  try {
    const resp = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    cache = { ts: Date.now(), data }
    return data
  } catch {
    return cache?.data ?? FALLBACK_CATALOG  // 写死回退
  }
}
```

---

### D3.3 凭证池（**1 天**）：`packages/backend/src/providers/credential-pool.ts`

```typescript
export class CredentialPool {
  private keys: string[] = []
  private strategy: 'fill_first' | 'round_robin' | 'random' = 'round_robin'
  private idx = 0
  private failed: Map<string, number> = new Map()

  constructor(envVar: string, strategy: 'fill_first' | 'round_robin' | 'random' = 'round_robin') {
    this.strategy = strategy
    const all = process.env[envVar] || ''
    // 支持 KEY1,KEY2,KEY3 形式
    this.keys = all.split(',').map(k => k.trim()).filter(Boolean)
  }

  pick(): string | null {
    if (this.keys.length === 0) return null
    if (this.strategy === 'fill_first') return this.keys[0]
    if (this.strategy === 'random') return this.keys[Math.floor(Math.random() * this.keys.length)]
    // round_robin + skip failed
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.idx + i) % this.keys.length]
      if (!this.failed.has(k) || Date.now() - (this.failed.get(k) || 0) > 60_000) {
        this.idx = (this.idx + 1) % this.keys.length
        return k
      }
    }
    return this.keys[0]
  }

  markFailed(key: string) { this.failed.set(key, Date.now()) }
  markOk(key: string) { this.failed.delete(key) }
}
```

**Provider 改用**：
```typescript
const pool = new CredentialPool('SILICONFLOW_API_KEY', 'round_robin')
const apiKey = pool.pick()
try {
  const r = await fetch(...)
  if (!r.ok) pool.markFailed(apiKey)
  else pool.markOk(apiKey)
  return r
} catch {
  pool.markFailed(apiKey)
  throw new Error('All keys failed')
}
```

#### D3.7 验收标准
- ✅ `.env` 写 `SILICONFLOW_API_KEY=key1,key2,key3`（逗号分隔）
- ✅ round_robin 策略：请求1→key1, 请求2→key2, 请求3→key3, 请求4→key1
- ✅ 某个 key 失败 → 60 秒内不再用那个 key
- ✅ `GET /api/providers/siliconflow/credentials` 显示池状态

---

### D4 OAuth 登录（**3 天**）

**目标**：老板点"Anthropic" → 跳 OAuth → 自动获得 token 存到 `auth.json`

#### D4.1 通用 OAuth Device Code 流程（1 天）：`packages/backend/src/auth/oauth.ts`

```typescript
export interface OAuthFlow {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export async function startDeviceCodeFlow(provider: 'anthropic' | 'openai-codex' | 'qwen'): Promise<OAuthFlow> {
  const urls: Record<string, string> = {
    anthropic: 'https://console.anthropic.com/oauth/device',
    'openai-codex': 'https://auth.openai.com/oauth/device',
    qwen: 'https://oauth.aliyun.com/oauth/device',
  }
  const resp = await fetch(urls[provider], { method: 'POST', body: JSON.stringify({ client_id: 'dasheng' }) })
  return await resp.json()
}

export async function pollDeviceCode(provider: string, deviceCode: string): Promise<{ access_token: string; refresh_token?: string }> {
  // 5s 间隔轮询
}
```

#### D4.2 前端按钮（1 天）：Settings → Models → 每个 provider 后面加 [OAuth 登录] 按钮

```typescript
<Button onClick={async () => {
  const flow = await http.post('/api/auth/oauth/start', { provider: 'anthropic' })
  alert(`打开 ${flow.verification_uri} 输入 ${flow.user_code}`)
  const token = await http.post('/api/auth/oauth/poll', { provider: 'anthropic', device_code: flow.device_code })
  // token 存到 auth.json
}}>🔗 OAuth 登录</Button>
```

#### D4.3 auth.json 管理（1 天）：`packages/backend/src/auth/store.ts`

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const AUTH_PATH = process.env.DASHENG_AUTH_PATH || join(homedir(), '.dasheng', 'auth.json')

export function readAuth() {
  if (!existsSync(AUTH_PATH)) return {}
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf-8')) } catch { return {} }
}

export function writeAuth(provider: string, token: { access_token: string; refresh_token?: string; expires_at?: number }) {
  const auth = readAuth()
  auth[provider] = token
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
}
```

---

### D5 配置/凭证分层（**3 天**）

**目标**：`~/.dasheng/{config.yaml,.env,auth.json}` + 热重载

#### D5.1 配置加载器（1 天）：`packages/backend/src/config-loader.ts`

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse, stringify } from 'yaml'

export const DASHENG_HOME = process.env.DASHENG_HOME || join(homedir(), '.dasheng')
const CONFIG_PATH = join(DASHENG_HOME, 'config.yaml')
const ENV_PATH = join(DASHENG_HOME, '.env')
const AUTH_PATH = join(DASHENG_HOME, 'auth.json')

export function ensureHome() {
  if (!existsSync(DASHENG_HOME)) mkdirSync(DASHENG_HOME, { recursive: true })
}

export function loadConfig(): Record<string, any> {
  ensureHome()
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, stringify({ backend: { port: 8000, host: '127.0.0.1' } }))
    return { backend: { port: 8000, host: '127.0.0.1' } }
  }
  return parse(readFileSync(CONFIG_PATH, 'utf-8')) || {}
}

export function saveConfig(config: Record<string, any>) {
  ensureHome()
  writeFileSync(CONFIG_PATH, stringify(config))
}

export function mergeEnv(updates: Record<string, string>) {
  ensureHome()
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8').split('\n').filter(Boolean) : []
  const map = new Map<string, string>()
  for (const line of existing) {
    const [k, ...v] = line.split('=')
    if (k) map.set(k.trim(), v.join('=').trim())
  }
  for (const [k, v] of Object.entries(updates)) map.set(k, v)
  const out = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('\n')
  writeFileSync(ENV_PATH, out)
  Object.assign(process.env, updates)
}
```

#### D5.2 API 端点（1 天）：

```typescript
// packages/backend/src/api/config.ts
app.get('/api/config', async () => loadConfig())
app.put('/api/config', async (req) => { saveConfig(req.body); return { ok: true } })
app.get('/api/env', async () => {
  const env = readFileSync(ENV_PATH, 'utf-8')
  return parseEnvToMap(env)  // 返 key→bool (存在)
})
app.put('/api/env', async (req) => { mergeEnv(req.body); return { ok: true } })
app.get('/api/auth', async () => readAuth())
```

#### D5.3 前端 Settings 子页（1 天）：`/settings/config` `/settings/keys` `/settings/auth`

---

### D6 Web Server 整合（**2 天**）

**目标**：把 2500 行的 server.ts 拆成 8 个模块文件

```
packages/backend/src/
  api/
    auth.ts              现有
    chat.ts              现有（最大）
    sessions.ts          现有
    social.ts            现有
    ...
    status.ts            D1 新增
    doctor.ts            D2 新增
    config.ts            D5 新增
    providers.ts         D3 新增
    models.ts            D3 新增
    auth-oauth.ts        D4 新增
```

每个文件 < 400 行，server.ts 只剩 ~100 行注册代码。

---

### D7 补 26 个 provider（**5 天**）

**目标**：26 个 provider 全部 plugin 化

按 Hermes 现有 29 个 - 已有 3 个 = 26 个，分批：
- Day 1：anthropic + openai + openrouter
- Day 2：qwen-oauth + alibaba + moonshot
- Day 3：ollama-cloud + xai + arcee + gmi
- Day 4：huggingface + nvidia + kilocode + opencode-zen
- Day 5：stepfun + zai + minimax + xiaomi + copilot + azure + bedrock

每个 ~60 行（plugin.yaml 4 行 + provider.ts 56 行）。

---

## 三、每日节奏（3.5 周）

```
Day 1  D1 状态条 + 重启
Day 2  D2 Doctor 后端
Day 3  D2 Doctor 前端 + 验收
Day 4  D3.1 Provider 接口 + D3.2 自动扫描
Day 5  D3.3 重写 3 个现有 provider
Day 6  D3.4 chat.ts 改用 + D3.5 模型目录
Day 7  D3.6 凭证池
Day 8  休 / 修 bug
Day 9  D4 OAuth 后端
Day 10 D4 OAuth 前端
Day 11 D4 auth.json
Day 12 D5 config loader
Day 13 D5 API 端点
Day 14 D5 前端 /settings/config
Day 15 休 / 修 bug
Day 16-20 D7 补 26 个 provider
Day 21-25 D6 Web Server 整合 + 整体 review
```

---

## 四、今天就开做（按老板指示"按方案执行"）

老板原话"按方案来执行"——我立刻开始 D1（状态条）+ D2（Doctor）。**今天交付**：

### 立刻动手 4 个文件
1. `packages/backend/src/api/status.ts` — 新建（D1.1 100 行）
2. `apps/web/src/components/SidebarStatusStrip.tsx` — 新建（D1.2 80 行）
3. `packages/backend/src/api/doctor.ts` — 新建（D2.1 200 行）
4. `apps/web/src/routes/_workspace.diagnostics.tsx` — 新建（D2.2 100 行）

### 加 4 处接入
5. `packages/backend/src/server.ts` — 注册 status + doctor 路由
6. `apps/web/src/screens/Shell.tsx` — 侧栏底部加 StatusStrip
7. `apps/web/src/screens/Settings.tsx` — 加 "系统诊断" 入口
8. `apps/web/src/main.tsx` — 注册 diagnostics 路由

### 1 个修复
9. `apps/web/package.json` — 确认有 `@tanstack/react-query` 依赖

**预计 1-2 小时完成**（含编译 + 测试）。

完成后老板立刻能看到：
- ✅ 底部色块（绿/红）
- ✅ Settings → 系统诊断 子页
- ✅ 8 章节 + 色块 + 修法
- ✅ 一键重启 AI 引擎

---

## 五、验收

- ✅ D1：`GET /api/status` 返回 14 字段；前端显示色块 + 重启按钮
- ✅ D2：`GET /api/doctor` 返回 8 章节；前端 `/settings/diagnostics` 显示
- ✅ D3：`GET /api/providers` 列出 3 个；丢目录自动发现
- ✅ D4：Anthropic OAuth 登录成功
- ✅ D5：`~/.dasheng/config.yaml` 存在；`PUT /api/config` 不重启生效
- ✅ D6：server.ts < 200 行
- ✅ D7：`/api/providers` 列出 29 个

**老板指示"按方案执行"——我现在就动手做 D1 + D2**。
