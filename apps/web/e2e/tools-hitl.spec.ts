// apps/web/e2e/tools-hitl.spec.ts · Phase E (2026-06-17)
// 验证 /api/v1/tools/:id/invoke 的 HITL 流程
//
// 设计: 每个 test beforeEach 删所有 sandbox.exec rule, 再插自己需要的
// (allow=0 deny 优先, 所以同时存在 allow 和 deny 的话会 deny — 真实场景也是这样)
//
// 跑法: cd apps/web && pnpm exec playwright test e2e/tools-hitl.spec.ts
// 依赖: backend :8000 起来 + admin/admin12345

import { test, expect, APIRequestContext } from '@playwright/test'

const BASE = 'http://127.0.0.1:8000'
const ADMIN = { username: 'admin', password: 'admin12345' }

async function login(req: APIRequestContext): Promise<string> {
  const r = await req.post(`${BASE}/api/v1/auth/login`, { data: ADMIN })
  expect(r.status(), `login 应 200`).toBe(200)
  return (await r.json()).access_token
}

async function invoke(token: string, body: Record<string, unknown>, req: APIRequestContext) {
  return await req.post(`${BASE}/api/v1/tools/sandbox.exec/invoke`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  })
}

test.describe('Phase E: HITL tool invoke', () => {
  let token: string
  let req: APIRequestContext

  test.beforeAll(async ({ playwright }) => {
    req = await playwright.request.newContext({ baseURL: BASE })
  })

  test.beforeEach(async () => {
    // 清空所有 sandbox.exec related rules, 保证 test 独立
    const { execSync } = await import('node:child_process')
    execSync(
      `sqlite3 /Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db "DELETE FROM tool_permissions WHERE tool_pattern = 'sandbox.exec' AND id LIKE 'tp_e2e_%'; DELETE FROM login_attempts;"`,
      { stdio: 'pipe' },
    )
    token = await login(req)
  })

  test('无 rule → 403 (fail-secure, 不走 HITL)', async () => {
    // beforeEach 已清, 此时应无 rule
    const r = await invoke(token, { params: { cmd: 'ls' }, timeout_ms: 1000 }, req)
    expect(r.status()).toBe(403)
    const body = await r.json()
    expect(body.code).toBe('TOOL_PERMISSION_DENIED')
  })

  test('allow=1 require_confirm=0 → 直接到 callSandbox (无 202)', async () => {
    // seed: allow rule
    const { execSync } = await import('node:child_process')
    execSync(
      `sqlite3 /Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db "INSERT INTO tool_permissions (id, user_id, role, tool_pattern, allow, require_confirm) VALUES ('tp_e2e_allow', NULL, 'ADMIN', 'sandbox.exec', 1, 0);"`,
      { stdio: 'pipe' },
    )
    const r = await invoke(token, { params: { cmd: 'ls' }, timeout_ms: 1000 }, req)
    // 200 (sandbox 跑) 或 502 (sandbox 没起, 但权限层过)
    expect([200, 502]).toContain(r.status())
    expect(r.status()).not.toBe(202)
  })

  test('allow=1 require_confirm=1 → 第一次 202, 带 confirm:true 后到 callSandbox', async () => {
    const { execSync } = await import('node:child_process')
    execSync(
      `sqlite3 /Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db "INSERT INTO tool_permissions (id, user_id, role, tool_pattern, allow, require_confirm) VALUES ('tp_e2e_confirm', NULL, 'ADMIN', 'sandbox.exec', 1, 1);"`,
      { stdio: 'pipe' },
    )
    // 第一次: 不带 confirm → 202 CONFIRM_REQUIRED
    const r1 = await invoke(token, { params: { cmd: 'ls' }, timeout_ms: 1000 }, req)
    expect(r1.status()).toBe(202)
    const body1 = await r1.json()
    expect(body1.code).toBe('CONFIRM_REQUIRED')
    expect(body1.require_confirm).toBe(true)
    expect(body1.tool_id).toBe('sandbox.exec')
    expect(body1.reason).toBeTruthy()

    // 第二次: 带 confirm: true → 通过
    const r2 = await invoke(token, { params: { cmd: 'ls' }, timeout_ms: 1000, confirm: true }, req)
    expect([200, 502]).toContain(r2.status())
    expect(r2.status()).not.toBe(202)
  })

  test('allow=0 → 403 (deny 优先, 不走 HITL)', async () => {
    const { execSync } = await import('node:child_process')
    execSync(
      `sqlite3 /Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db "INSERT INTO tool_permissions (id, user_id, role, tool_pattern, allow, require_confirm) VALUES ('tp_e2e_deny', NULL, 'ADMIN', 'sandbox.exec', 0, 1);"`,
      { stdio: 'pipe' },
    )
    const r = await invoke(token, { params: { cmd: 'ls' }, timeout_ms: 1000, confirm: true }, req)
    expect(r.status()).toBe(403)
    const body = await r.json()
    expect(body.code).toBe('TOOL_PERMISSION_DENIED')
  })
})
