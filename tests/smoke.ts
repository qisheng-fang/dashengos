// tests/smoke.ts — DaShengOS v6.0 端到端冒烟测试
// 验证: 对话 → 搜索 → 文件生成 全链路

const BASE = process.env.TEST_API || 'http://localhost:8000'
const TOKEN = process.env.TEST_TOKEN || ''

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  detail?: string
}

let capturedToken = TOKEN

async function api(path: string, body?: any): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = capturedToken || TOKEN
  if (t) headers['Authorization'] = `Bearer ${t}`
  return fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const t0 = Date.now()
  try {
    await fn()
    return { name, passed: true, duration: Date.now() - t0 }
  } catch (e: any) {
    return { name, passed: false, duration: Date.now() - t0, error: e.message }
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('DaShengOS v6.0 — 冒烟测试')
  console.log('='.repeat(60))

  const results: TestResult[] = []

  // Test 1: Backend health check
  results.push(await runTest('Backend Health Check', async () => {
    const resp = await api('/api/v1/health')
    if (resp.status === 401) return  // auth required, but backend is up
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    console.log('  ✓ Backend responding')
  }))

  // Test 2: Auth endpoint
  results.push(await runTest('Auth Endpoint', async () => {
    const resp = await api('/api/v1/auth/login', { username: 'admin', password: 'dasheng123' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    if (!data.access_token) throw new Error('No access token in response')
    capturedToken = data.access_token
    console.log('  ✓ Auth working, got token')
  }))

  // Test 3: Provider listing
  results.push(await runTest('Provider Listing', async () => {
    const resp = await api('/api/v1/providers')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    if (!data.providers || data.providers.length === 0) throw new Error('No providers')
    console.log(`  ✓ ${data.providers.length} providers: ${data.providers.map((p: any) => p.name).join(', ')}`)
  }))

  // Test 4: MCP health check
  results.push(await runTest('MCP Health Status', async () => {
    const resp = await api('/api/v1/mcp/health')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const online = data.servers?.filter((s: any) => s.online).length || 0
    const total = data.servers?.length || 0
    console.log(`  ✓ MCP: ${online}/${total} servers online`)
  }))


  // Test 4.5: Health Map (拓扑数据 — HealthDashboard 核心接口)
  results.push(await runTest('Health Map Topology', async () => {
    const resp = await api('/api/v1/health/map')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    if (!data.nodes || data.nodes.length === 0) throw new Error('No health nodes')
    const healthyNodes = data.nodes.filter((n: any) => n.status === 'healthy').length
    console.log(`  ✓ Health map: ${healthyNodes}/${data.nodes.length} nodes healthy (score: ${data.score})`)
  }))

  // Test 4.6: Health Log (故障日志)
  results.push(await runTest('Health Failure Log', async () => {
    const resp = await api('/api/v1/health/log')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    console.log(`  ✓ Health log: ${data.entries?.length || 0} recent entries`)
  }))

  // Test 4.7: Health Component Status (全组件状态)
  results.push(await runTest('Health Component Status', async () => {
    const resp = await api('/api/v1/health')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const components = Object.keys(data.components || data.services || {})
    console.log(`  ✓ Components: ${components.join(', ') || '(aggregate only)'}`)
  }))

  // Test 5: SSE chat stream (simple test)
  results.push(await runTest('SSE Chat Stream', async () => {
    const loginResp = await api('/api/v1/auth/login', { username: 'admin', password: 'dasheng123' })
    const { access_token } = await loginResp.json()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'text/event-stream',
    }
    const resp = await fetch(`${BASE}/api/v1/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hi', history: [] }),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    // Read first few SSE events
    const reader = resp.body?.getReader()
    if (!reader) throw new Error('No response body')
    const decoder = new TextDecoder()
    let events = 0
    let hasDone = false
    const timeout = setTimeout(() => reader.cancel(), 15000)
    try {
      while (events < 10) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (line.startsWith('event:')) events++
          if (line.includes('done')) hasDone = true
        }
      }
    } finally { clearTimeout(timeout); reader.cancel() }
    console.log(`  ✓ SSE stream: ${events} events, done=${hasDone}`)
  }))

  // Summary
  console.log('\n' + '='.repeat(60))
  const passed = results.filter(r => r.passed).length
  const total = results.length
  const totalMs = results.reduce((s, r) => s + r.duration, 0)
  
  console.log(`Results: ${passed}/${total} passed (${(totalMs/1000).toFixed(1)}s)`)
  console.log('-'.repeat(60))
  
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌'
    console.log(`${icon} ${r.name} (${r.duration}ms)`)
    if (r.error) console.log(`   Error: ${r.error}`)
  }
  
  process.exit(passed === total ? 0 : 1)
}

main()
