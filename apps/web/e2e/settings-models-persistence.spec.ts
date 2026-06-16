// apps/web/e2e/settings-models-persistence.spec.ts · Phase A (2026-06-17)
// 验证 model config 真持久化 · 解决 e2e 只测可见性不测保存的盲区
//
// 跑法:
//   cd apps/web && pnpm exec playwright test e2e/settings-models-persistence.spec.ts --reporter=list
// 依赖: backend :8000 起来 (含 Phase A user_settings 表 + 5 endpoints)
// 不需要 chromium 浏览器 — 用 Playwright APIRequestContext 直接打 backend

import { test, expect, APIRequestContext } from '@playwright/test'

const BASE = 'http://127.0.0.1:8000'
const ADMIN = { username: 'admin', password: 'admin12345' }
const TEST_KEY = `sk-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function login(req: APIRequestContext): Promise<string> {
  const r = await req.post(`${BASE}/api/v1/auth/login`, { data: ADMIN })
  expect(r.status(), `login 应 200, 实际 ${r.status()}`).toBe(200)
  return (await r.json()).access_token
}

test.describe('Phase A: model config 真持久化 (POST → GET roundtrip)', () => {
  let token: string
  let req: APIRequestContext

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext({ baseURL: BASE })
    // 清干净 (避免其他测试遗留)
    await req.post(`${BASE}/api/v1/auth/login`, { data: ADMIN })
  })

  test.beforeEach(async () => {
    // 清 lockout 避免 Phase B.1 测试污染 (5 fail 锁 15min)
    const { execSync } = await import('node:child_process')
    execSync(
      `sqlite3 /Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db "DELETE FROM login_attempts;"`,
      { stdio: 'pipe' },
    )
    token = await login(req)
  })

  test('save+reload: provider key roundtrip', async () => {
    // 1. PUT
    const put = await req.put(`${BASE}/api/v1/settings/provider/siliconflow`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { apiKey: TEST_KEY },
    })
    expect(put.status()).toBe(200)
    const putBody = await put.json()
    expect(putBody).toMatchObject({ ok: true, hasKey: true, provider: 'siliconflow' })

    // 2. GET (核心: 验证持久化)
    const get = await req.get(`${BASE}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(get.status()).toBe(200)
    const body = await get.json()
    expect(body.providers?.siliconflow).toBeDefined()
    expect(body.providers.siliconflow.hasKey).toBe(true)
    expect(body.providers.siliconflow.envKey).toBe('SILICONFLOW_API_KEY')

    // 3. DELETE 清理
    const del = await req.delete(`${BASE}/api/v1/settings/provider/siliconflow`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(del.status()).toBe(200)
    expect((await del.json()).hasKey).toBe(false)
  })

  test('save+reload: text model chain roundtrip', async () => {
    // 1. PUT 降级链
    const chain = ['ollama:qwen2.5:7b', 'siliconflow:Qwen/Qwen2.5-72B-Instruct', 'deepseek:deepseek-chat']
    const put = await req.put(`${BASE}/api/v1/settings/models/text`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { chain },
    })
    expect(put.status()).toBe(200)
    expect((await put.json()).chain).toEqual(chain)

    // 2. GET 验证持久化
    const get = await req.get(`${BASE}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await get.json()
    expect(body.text?.chain).toEqual(chain)

    // 3. DELETE 恢复默认
    await req.put(`${BASE}/api/v1/settings/models/text`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { chain: ['ollama:qwen2.5:7b', 'deepseek:deepseek-chat'] },
    })
  })

  test('Phase B.1: login lockout 5/15min 真触发', async () => {
    // 5 次错密码 → 第 6 次 429
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await req.post(`${BASE}/api/v1/auth/login`, {
        data: { username: 'admin', password: 'wrongpassword999' },
      })
      codes.push(r.status())
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(codes[5]).toBe(429)
    // 验 Retry-After 头存在
    const locked = await req.post(`${BASE}/api/v1/auth/login`, {
      data: { username: 'admin', password: 'wrongpassword999' },
    })
    expect(locked.headers()['retry-after']).toBeDefined()
    // 清锁定 (避免污染下一个 test)
    const loginOk = await req.post(`${BASE}/api/v1/auth/login`, { data: ADMIN })
    expect(loginOk.status()).toBe(429) // 还锁, 不能这样清
    // 直接清 DB
  })

  test('Phase B.2: Stripe webhook 没签名 → 400 SIGNATURE_INVALID (dev MOCK_MODE=true 跳过, 跳过此测)', async () => {
    // .env 设 DASHENG_STRIPE_MOCK_MODE=true (dev 默认), webhook 接受无签名 body
    // 在 prod (MOCK_MODE=false) 这测会返 400
    // 此测只 mark dev mode 行为, prod 应单独跑
    test.skip(true, 'dev mock 模式不测, 改 .env MOCK_MODE=false 后 enable')
  })

  test('Phase D.8: X-Request-Id header 回写', async () => {
    const rid = `req_e2e_${Date.now()}`
    const r = await req.get(`${BASE}/api/v1/system/status`, {
      headers: { 'X-Request-Id': rid },
    })
    expect(r.status()).toBe(200)
    expect(r.headers()['x-request-id']).toBe(rid)
  })
})
