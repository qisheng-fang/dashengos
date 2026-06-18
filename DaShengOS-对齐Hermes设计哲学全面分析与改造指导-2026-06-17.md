# DaShengOS v0.3 → 对齐 Hermes 设计哲学 · 全面分析与改造指导

> **作者**：WorkBuddy (Deepseek-V4-Pro)
> **日期**：2026-06-17 23:07
> **核心问题**：老板原话"hermes 能自动配置模型 + 后端驱动前端薄壳 + 缺技能时全面提示 + 一切都在后端、前端只看能不能完成任务"
> **结论先行**：DaShengOS **没抄到 Hermes 的核心架构**——没有 provider 插件系统、没有配置/凭证/状态分层、没有 Sidebar 状态条、没有 doctor 自检。

---

## 一、老板说的"hermes 体验"翻译成 3 条设计原则

老板原话：
> "hermes 自动配置模型、WebUI 前端只有入口、后端全管、模块状态都在后端、前端只看能不能完成。"

翻译成 Hermes 实际做到的 3 条设计哲学：

| # | 哲学 | Hermes 体现 |
|---|------|------------|
| 1 | **后端厚、前端薄、状态真源在 `~/.hermes/`** | web_server 4442 行 / 69 个 API / 配置走 `config.yaml` + `.env` + `auth.json` 三层 |
| 2 | **新功能 = 丢一个目录即可** | 16+ provider 各在 `plugins/model-providers/<name>/`，`pkgutil.iter_modules` 自动扫描；skills 26 个分类同样 plugin 化 |
| 3 | **缺啥就在主界面给色块，不让用户进子页瞎找** | `SidebarStatusStrip` 1 个色块（gateway running/starting/failed/stopped）+ active_sessions 计数；`SidebarSystemActions` 2 个按钮（restart / update）；其他都在子页 |

---

## 二、Hermes vs DaShengOS 实际差距（带数字）

### 2.1 配置与凭证体系

| 维度 | Hermes | DaShengOS v0.3 | 差距 |
|---|---|---|---|
| **配置分层** | `~/.hermes/config.yaml`（可见配置 8KB）+ `~/.hermes/.env`（secrets）+ `~/.hermes/auth.json`（OAuth tokens） | 单文件 `packages/backend/.env`（45 行，混 secrets + 配置） | ❌ 没分层 |
| **配置文件路径** | `get_hermes_home()` 全局函数 | `process.env.X` 散落各处 | ❌ |
| **热重载** | `PUT /api/config` / `PUT /api/env` / `POST /api/model/set` 三个端点 | 改 `.env` 必须重启 backend | ❌ |
| **凭证轮换** | `credential_pool.py` 三策略：fill_first / round_robin / random | 无 | ❌ |
| **Doctor 自检** | `hermes doctor` 1854 行，分 14 章节（Security / Python / Packages / Config / Keys / Providers / Tokens / Gateway / Cron / Sessions...） | 无 | ❌ |

### 2.2 LLM Provider 体系（**老板说的"自动配置模型"核心**）

| 维度 | Hermes | DaShengOS v0.3 | 差距 |
|---|---|---|---|
| **Provider 数量** | **29 个**（Anthropic / OpenAI / OpenRouter / DeepSeek / SiliconFlow / Ollama / Qwen-OAuth / Z.ai / Kimi / GMI / Arcee / HuggingFace / NVIDIA NIM / Alibaba / Bedrock / Azure / Copilot / KiloCode / Vercel / Xiaomi ...） | **3 个**（SiliconFlow / DeepSeek / Ollama，但只在 `.env` 里写死） | ❌ -26 |
| **新增 provider 成本** | **丢一个目录** = `plugins/model-providers/<name>/{__init__.py, plugin.yaml}` 自动扫描 | 改 `.env` + 改 `config.ts` + 改 `chat.ts` + 重启 | ❌ |
| **Provider 元信息** | `ProviderProfile` 类（auth_type / api_mode / fallback_models / default_max_tokens / default_headers / hostname / signup_url ...） | 散落在 `chat.ts` 几个 if-else | ❌ |
| **OAuth 登录** | Anthropic / Qwen / OpenAI Codex 都支持 OAuth device code | 无 | ❌ |
| **模型目录拉取** | 远程 `model-catalog.json` 24h TTL + 磁盘缓存 + 内置回退 | 写死在 `config.ts` | ❌ |

### 2.3 WebUI 入口设计

| 维度 | Hermes Web UI | DaShengOS v0.3 | 差距 |
|---|---|---|---|
| **侧栏** | 12 内置 + 插件注入 + 底部 `SidebarStatusStrip`(1 色块 + 1 计数) + `SidebarFooter`(版本号) | 8 个 Shell 入口 + 无状态条 | ❌ |
| **首页默认** | `/sessions` (列表) | `Workspace`（孤零零一个聊天框） | ⚠️ |
| **状态显示** | SidebarStatusStrip 1 行显示 gateway 状态（绿/黄/红/灰）+ active sessions 计数 | 无 | ❌ |
| **系统按钮** | `SidebarSystemActions` 2 个：`Restart Gateway` / `Update Hermes` | 无 | ❌ |
| **插件扩展** | 写 `manifest.json` 即可注入 nav / 覆盖内置页 / `tab.position: "after:models"` | 无 | ❌ |
| **Chat 体验** | 嵌入式 xterm.js PTY（直接用 CLI）+ 侧边 ChatSidebar 展示 tool calls | `Workspace.tsx` 一个 textarea + 一个 Card 列表 | ❌ |

### 2.4 后端驱动 + 状态真源

| 维度 | Hermes | DaShengOS v0.3 | 差距 |
|---|---|---|---|
| **Web Server** | FastAPI 4442 行 / 69 端点 | Fastify 约 2500 行 / 54 端点（多但散） | ⚠️ |
| **状态 API** | `GET /api/status` 14 字段（version / gateway_running / gateway_pid / gateway_state / gateway_platforms / active_sessions / config_path / env_path / ...） | `GET /api/v1/health` 3 字段（status / version / uptime） | ❌ |
| **Gateway 独立进程** | `gateway/` 26 文件，独立 daemon，写 `~/.hermes/gateway_state.json` | DeerFlow daemon 独立，但**没暴露 state.json**给前端 | ❌ |
| **重启系统操作** | `POST /api/gateway/restart` / `POST /api/hermes/update` | 无 | ❌ |
| **日志 API** | `GET /api/logs` | 无（只有 server.log 文件） | ❌ |

### 2.5 "缺啥就提示"机制

| 维度 | Hermes | DaShengOS v0.3 | 差距 |
|---|---|---|---|
| **诊断命令** | `hermes doctor --fix` / `--ack` 14 章节结构化输出 | 无 | ❌ |
| **缺 API key 提示** | `check_warn("No API key found in ~/.hermes/.env")` + setup_wizard 弹选项 | 无（chat.ts 直接 503 报错）| ❌ |
| **缺技能降级** | `lazy_deps.py` 延迟导入 + `setup_wizard` 显式降级告知 | 无（直接失败）| ❌ |
| **前端状态色** | gateway running=绿 / starting=黄 / failed=红 / stopped=灰 | 无 | ❌ |
| **webui 提示** | `/skills` 子页全展示 + `/models` 子页全展示 | Settings → Skills Market（功能有，但藏很深）| ⚠️ |

---

## 三、老板问的两个核心问题

### Q1: "AI 工作台能不能也像 hermes 一样"？

**可以，但要分 4 期改造：**

| 期 | 工期 | 改造内容 | 老板立刻能感受到什么 |
|---|---|---|---|
| **P0 状态条** | 1 天 | 后端 `GET /api/status` 扩到 14 字段；前端 `Shell.tsx` 底部加 `StatusStrip` + 1 按钮（重启 backend） | 一眼看到所有后端服务健康度 |
| **P1 provider 插件化** | 1 周 | `packages/backend/src/providers/plugins/<name>/`，29 个 provider 全部对齐 | 改 `.env` 加 provider；不重启热加载 |
| **P2 doctor 自检** | 1 周 | `dasheng doctor` 命令 + `GET /api/doctor` 端点 + 前端 `/diagnostics` 子页 | 缺啥直接列出 + 修法 |
| **P3 配置/凭证分层** | 2 周 | `~/.dasheng/config.yaml` + `.env` + `auth.json`；热重载 | 改配置不重启；可独立备份 secrets |

### Q2: "如果没装技能，能不能像 hermes 一样全面分析提示"？

**可以，分两段：**

**段 A: 立即能做（半天）**

加 `GET /api/doctor` 端点 + 前端 `/diagnostics` 子页：
- 检查每个 provider 的 API key 是否配（绿色=OK / 红色=缺失 + 修法）
- 检查关键 Python 包（python-docx / python-pptx / weasyprint）是否装
- 检查每个后端服务（Fastify :8000 / DeerFlow daemon / Vite :3000）是否活
- 检查数据目录是否可写 / DB 是否能开
- 检查端口冲突

输出格式参考 Hermes doctor：
```
✅ Backend :8000            running  · uptime 4h
✅ DeerFlow daemon          running  · 0 active tasks
✅ SiliconFlow provider     configured · Qwen/Qwen2.5-72B
⚠️  DeepSeek provider       API key missing → 配置 DEEPSEEK_API_KEY
❌ Playwright browser       python-playwright not installed → /Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/pip install playwright
❌ weasyprint (PDF)         not installed → 同上
✅ Sessions table           5 sessions / 0 messages
✅ Skills marketplace       15 installed / 0 active
```

**段 B: 1 周内（`hermes doctor` 全套）**

`dasheng doctor` CLI 命令 + `--fix` 自动修 + `--ack <advisory>` 静默：
- 14 章节结构化输出（Security / Python Env / Packages / Config / Keys / Providers / Tokens / Browser / Gateway / DB / Sessions / Skills / Cron / Logs）
- 每章节独立 `check_ok / check_warn / check_fail / check_info` 函数
- `--fix` 自动 pip install / 创建目录 / 重置 DB / 启 daemon
- 把结果写到 `~/.dasheng/doctor.log` 持久化

---

## 四、对齐 Hermes 的具体路线图

### Phase 1：状态条 + 重启按钮（**1 天**）

**目标**：老板一进 UI 就能看到所有后端服务健康度，**前端只显示"能不能用"**。

#### 1.1 后端 `GET /api/status` 升级
```typescript
// packages/backend/src/api/status.ts
app.get('/api/status', async () => {
  return {
    version: '0.3.0',
    uptime_sec: process.uptime(),
    backend: { running: true, port: 8000, host: '127.0.0.1' },
    gateway: {
      running: deerflowAlive(),
      state: deerflowAlive() ? 'running' : 'stopped',
      active_sessions: getActiveSessionCount(),
      socket: '/tmp/dasheng/deerflow.sock',
    },
    providers: {
      siliconflow: { configured: !!process.env.SILICONFLOW_API_KEY, model: 'Qwen/Qwen2.5-72B-Instruct' },
      deepseek: { configured: !!process.env.DEEPSEEK_API_KEY, model: 'deepseek-chat' },
      ollama: { configured: !!process.env.OLLAMA_HOST, model: 'qwen2.5:7b' },
    },
    python_deps: {
      'python-docx': isInstalled('docx'),
      'python-pptx': isInstalled('pptx'),
      'weasyprint': isInstalled('weasyprint'),
      'openpyxl': isInstalled('openpyxl'),
      playwright: isInstalled('playwright'),
    },
    db: { path: './data/dasheng.db', sessions: getSessionCount(), messages: getMessageCount() },
    storage: { docs_dir_writable: checkDir('/tmp/dasheng-docs') },
  }
})

app.post('/api/system/restart', async () => {
  // 1. 关 backend（pm2 / nohup 外部会拉起）
  // 2. 触发 DeerFlow daemon 重启
  // 3. 返回 { restart_in_sec: 3 }
})
```

#### 1.2 前端 StatusStrip 组件
```typescript
// apps/web/src/components/SidebarStatusStrip.tsx
export function SidebarStatusStrip() {
  const { data: status, refetch: refetchStatus } = useQuery(['status'], () => http.get('/api/status'), {
    refetchInterval: 10_000,  // 每 10s 拉一次
  })
  
  const gatewayTone = status?.gateway.running ? 'bg-green-500' : 'bg-red-500'
  const providerOkCount = Object.values(status?.providers ?? {}).filter(p => p.configured).length
  const providerTotal = Object.keys(status?.providers ?? {}).length
  
  return (
    <div className="border-t border-neutral-800 px-3 py-3 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${gatewayTone}`} />
        <span className="text-neutral-300">{status?.gateway.running ? 'AI 引擎在线' : 'AI 引擎离线'}</span>
        <span className="text-neutral-500 ml-auto">· {status?.gateway.active_sessions ?? 0} 会话</span>
      </div>
      <div className="flex items-center gap-2 mb-2 text-neutral-500">
        <span>📡 {providerOkCount}/{providerTotal} 模型</span>
        <span>📊 {status?.db.sessions ?? 0} 历史</span>
      </div>
      <button 
        onClick={async () => {
          await http.post('/api/system/restart')
          setTimeout(() => refetchStatus(), 3000)
        }}
        className="w-full text-[10px] text-neutral-400 hover:text-brand py-1 border border-neutral-800 rounded"
      >
        🔄 重启 AI 引擎
      </button>
    </div>
  )
}
```

---

### Phase 2：Provider 插件化（**1 周**）

**目标**：老板想加新模型 = 丢一个文件，不改任何代码。

#### 2.1 Provider 插件目录结构
```
packages/backend/src/providers/
  plugins/
    openai/
      plugin.yaml        # 元信息
      provider.ts        # 实现 ProviderProfile 接口
    anthropic/
    qwen/
    siliconflow/
    ollama/
    deepseek/
```

#### 2.2 provider.ts 接口
```typescript
// packages/backend/src/providers/base.ts
export interface ProviderProfile {
  name: string                       // 'siliconflow'
  displayName: string                // 'SiliconFlow（硅基流动）'
  description: string                // 'OpenAI 兼容 API，国内直连'
  signupUrl: string                  // 'https://cloud.siliconflow.cn/account/ak'
  
  // 鉴权
  authType: 'api_key' | 'oauth' | 'aws_sdk' | 'none'
  envVars: string[]                  // ['SILICONFLOW_API_KEY']
  
  // 端点
  baseUrl: string                    // 'https://api.siliconflow.cn/v1'
  modelsUrl?: string                 // 默认 {baseUrl}/models
  
  // 客户端
  defaultHeaders?: Record<string, string>
  fixedTemperature?: number | null
  
  // 模型
  fallbackModels: string[]           // ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-7B-Instruct']
  defaultModel: string
  
  // 能力
  supportsTools: boolean
  supportsVision: boolean
  contextWindow: number
  
  // 调用
  chat: (req: ChatRequest) => Promise<ChatResponse>
  listModels: (apiKey: string) => Promise<string[]>
  
  // 自检
  test: (apiKey: string) => Promise<{ ok: boolean; latency_ms: number; error?: string }>
}
```

#### 2.3 自动扫描
```typescript
// packages/backend/src/providers/index.ts
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const PROVIDERS: Map<string, ProviderProfile> = new Map()

export function loadProviders() {
  const dir = join(__dirname, 'plugins')
  for (const name of readdirSync(dir)) {
    const pluginPath = join(dir, name, 'provider.ts')
    if (!existsSync(pluginPath)) continue
    const mod = require(pluginPath)
    const profile: ProviderProfile = mod.default || mod
    PROVIDERS.set(name, profile)
  }
}

export function getProvider(name: string): ProviderProfile | undefined {
  return PROVIDERS.get(name)
}

export function listProviders() {
  return Array.from(PROVIDERS.values()).map(p => ({
    name: p.name,
    displayName: p.displayName,
    authType: p.authType,
    configured: p.envVars.every(v => !!process.env[v]),
  }))
}
```

#### 2.4 chat.ts 改用
```typescript
// chat.ts directLLM 改成
async function directLLM(message, history) {
  const providerName = process.env.LLM_PROVIDER || 'siliconflow'
  const provider = getProvider(providerName)
  if (!provider) throw new Error(`Provider not found: ${providerName}`)
  
  const apiKey = process.env[provider.envVars[0]] || ''
  if (provider.authType === 'api_key' && !apiKey) throw new Error(`${provider.name} API key not set`)
  
  return provider.chat({
    model: process.env[provider.name.toUpperCase() + '_DEFAULT_MODEL'] || provider.defaultModel,
    messages: buildMessages(history, message),
  })
}
```

**老板以后加新模型只要**：
1. 复制 `packages/backend/src/providers/plugins/siliconflow/` 到 `qwen/`
2. 改 `baseUrl` + `defaultModel` + `authType`
3. 重启 backend → 自动出现在 `/api/providers` 列表

---

### Phase 3：Doctor 自检（**1 周**）

#### 3.1 `dasheng doctor` CLI
```bash
# 安装到 /usr/local/bin
dasheng doctor            # 完整诊断
dasheng doctor --fix      # 自动修可修的
dasheng doctor --ack SECURITY-001  # 静默某条 advisory
```

#### 3.2 `GET /api/doctor` 端点
```typescript
// packages/backend/src/api/doctor.ts
app.get('/api/doctor', async () => {
  return {
    sections: [
      {
        name: 'Python Environment',
        checks: [
          { status: 'ok', text: 'Python 3.11.5', detail: '(推荐 3.11+)' },
          { status: 'ok', text: 'Virtual env active', detail: '/Users/apple/Desktop/ai-workbench-v2/agent/.venv' },
        ]
      },
      {
        name: 'Required Packages',
        checks: [
          { status: 'ok', text: 'python-docx', detail: 'v0.8.11' },
          { status: 'ok', text: 'python-pptx', detail: 'v0.6.21' },
          { status: 'warn', text: 'weasyprint not installed', detail: 'pip install weasyprint' },
        ]
      },
      {
        name: 'LLM Providers',
        checks: [
          { status: 'ok', text: 'SiliconFlow', detail: 'Qwen/Qwen2.5-72B-Instruct · configured' },
          { status: 'warn', text: 'DeepSeek', detail: 'API key missing → set DEEPSEEK_API_KEY' },
        ]
      },
      {
        name: 'Backend Services',
        checks: [
          { status: 'ok', text: 'Fastify :8000', detail: 'uptime 4h' },
          { status: 'ok', text: 'DeerFlow daemon', detail: 'running · 0 active' },
          { status: 'ok', text: 'Vite :3000', detail: 'running' },
        ]
      },
      {
        name: 'Data',
        checks: [
          { status: 'ok', text: 'SQLite DB', detail: '5 sessions / 0 messages' },
          { status: 'warn', text: 'Sessions have 0 messages', detail: 'chat.ts may not be persisting' },
        ]
      },
      {
        name: 'Browser Automation',
        checks: [
          { status: 'fail', text: 'Playwright Chromium not installed', detail: 'agent/.venv/bin/python -m playwright install chromium' },
        ]
      },
    ]
  }
})
```

#### 3.3 前端 `/diagnostics` 子页
```typescript
// apps/web/src/routes/_workspace.diagnostics.tsx
export function DiagnosticsPage() {
  const { data } = useQuery(['doctor'], () => http.get('/api/doctor'))
  
  return (
    <div className="p-6 space-y-6">
      {data?.sections.map(sec => (
        <Card key={sec.name} className="p-4">
          <h2 className="text-lg font-semibold mb-3">{sec.name}</h2>
          <div className="space-y-1">
            {sec.checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span>{c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}</span>
                <div>
                  <span className={c.status === 'fail' ? 'text-red-400' : ''}>{c.text}</span>
                  {c.detail && <span className="text-neutral-500 text-xs ml-2">· {c.detail}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
```

---

### Phase 4：配置/凭证分层（**2 周**）

#### 4.1 三层配置
```
~/.dasheng/
  config.yaml          # 可见配置 (端口、模型偏好、UI 设置)
  .env                 # API key + secrets
  auth.json            # OAuth tokens
  state.json           # gateway state / sessions 摘要 / 缓存
  doctor.log           # 历史自检结果
  skills/              # 已装 skill 副本
  sessions/            # 原始 session JSON 备份
  plugins/             # 用户自装 provider / skill
```

#### 4.2 后端 config 加载器
```typescript
// packages/backend/src/config-loader.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'

const DASHENG_HOME = process.env.DASHENG_HOME || join(homedir(), '.dasheng')

export function loadConfig() {
  // 1. 读 ~/.dasheng/config.yaml（可见配置）
  const configPath = join(DASHENG_HOME, 'config.yaml')
  const config = existsSync(configPath) ? parseYaml(readFileSync(configPath, 'utf-8')) : {}
  
  // 2. 读 ~/.dasheng/.env（secrets，永不进 git）
  const envPath = join(DASHENG_HOME, '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const [k, ...v] = line.split('=')
      if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim()
    }
  }
  
  // 3. 读 auth.json（OAuth）
  const authPath = join(DASHENG_HOME, 'auth.json')
  const auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf-8')) : {}
  
  return { config, env: process.env, auth }
}
```

#### 4.3 热重载 API
```typescript
app.put('/api/config', async (req, reply) => {
  const newConfig = req.body
  const path = join(DASHENG_HOME, 'config.yaml')
  writeFileSync(path, dumpYaml(newConfig))
  reloadConfig()  // 不重启就生效
  return { ok: true }
})

app.put('/api/env', async (req, reply) => {
  const updates = req.body
  // 只更新 .env 不影响 process.env 中其他变量
  mergeEnvFile(updates)
  Object.assign(process.env, updates)  // 立即生效
  return { ok: true }
})
```

---

## 五、立即可动手的最小可用版（**1 天交付**）

如果老板想今天就感受到"hermes 那种状态条 + 缺啥提示"，我建议做**3 件**：

### 5.1 后端加 `GET /api/status`（30 行代码）
文件：`packages/backend/src/api/status.ts`
返回：backend / gateway / providers / python_deps / db 5 大块状态

### 5.2 前端加 SidebarStatusStrip（40 行代码）
文件：`apps/web/src/components/SidebarStatusStrip.tsx`
显示：色块（绿/红）+ 当前 provider + 重启按钮

### 5.3 后端加 `GET /api/doctor`（80 行代码）
文件：`packages/backend/src/api/doctor.ts`
返回：14 章节结构化检查结果（参考 Hermes doctor 章节）

**做完立刻能看到的效果**：
- 老板进 UI → 底部状态条显示"AI 引擎在线 ✅"
- 老板点 Settings → 看到 `/diagnostics` 子页 → 列出所有缺什么 + 怎么修
- 老板点 "重启 AI 引擎" → backend 自动重启，状态条变绿
- 老板点"换模型" → 看到所有 29 个 provider 列表（仿 Hermes）

**老板要我直接动手做 5.1+5.2+5.3 吗？** 这是 1 天能交付的最小可感受版本。
做完整 4 期（**3-4 周**）能真正对齐 Hermes 设计哲学。

---

## 六、风险与权衡

| 风险 | 应对 |
|---|---|
| Provider 插件化改动大，可能引入 bug | 先做 Phase 1 状态条（最低风险），验证方向再做后续 |
| Doctor 14 章节写起来量大 | 先做 4 个核心章节（Providers / Services / DB / Python Deps），其他后续补 |
| 凭证分层老板已有 .env 习惯 | 兼容：先保留 `.env` 在 `packages/backend/`，同时支持 `~/.dasheng/.env`，二者自动合并 |
| 后端状态条频繁 poll 影响性能 | 10s 拉一次，前端 SWR 缓存 |
| 老板的"hermes 体验"期望值不明确 | 5.1+5.2+5.3 先出 demo，老板看了再决定继续深度 |

---

## 七、下一步行动

**请老板决定**：

1. **今天做 Phase 1 最小版**（状态条 + 1 按钮 + doctor 14 章 4 核心，**1 天 4 小时**）— 立刻能感受到 hermes 那种"前端只显示能不能用"
2. **做完整 Phase 1-3**（**3-4 周**）— 真正对齐 Hermes：provider 插件化、doctor 全套、配置/凭证分层
3. **先存报告，下次集中做** — 等老板方便时再说
4. **加 skill marketplace 的"安装状态检查"**（独立子任务）— 仿 Hermes 的 `/skills` 页面把所有"已装/未装/装错"用色块列出来

**我推荐选项 1**——1 天交付，老板能立刻对比"之前 vs 之后"感受差异，确认方向后我们再做完整版。

---

## 八、附：Hermes 核心文件清单（老板有空可看）

```
~/.hermes/hermes-agent/
├── hermes_cli/
│   ├── main.py              11885 行 · CLI 入口
│   ├── web_server.py         4442 行 · FastAPI 69 端点
│   ├── doctor.py             1854 行 · 14 章节自检（--fix / --ack）
│   ├── setup_wizard.py       引导配置 wizard
│   ├── config.py             ~/.hermes/config.yaml 加载
│   ├── env_loader.py         ~/.hermes/.env 加载
│   ├── auth.py               ~/.hermes/auth.json 加载
│   ├── pty_bridge.py         嵌入式 PTY 桥
│   └── ...                   共 79 个文件
├── gateway/                  26 个文件 · 消息平台 daemon
├── providers/
│   ├── base.py               ProviderProfile 基类
│   └── plugins/              29 个 provider 插件（每目录一个）
├── plugins/
│   └── model-providers/      同样的 provider 插件
├── skills/                   26 个 skill 分类
├── web/                      React 19 + TS + Vite + Tailwind v4 前端
│   ├── src/App.tsx
│   ├── src/components/
│   │   ├── SidebarStatusStrip.tsx
│   │   ├── SidebarFooter.tsx
│   │   ├── SidebarSystemActions.tsx
│   │   └── ChatSidebar.tsx
│   └── src/pages/            12 个内置页面
└── hermes_constants.py       远程模型目录 / OAuth 配置
```

**每章节独立**：`check_ok / check_warn / check_fail / check_info` 4 个 helper 函数 + 14 个章节函数 — 这是 Hermes doctor 的精华设计，**我们抄这个就够用 5 年**。
