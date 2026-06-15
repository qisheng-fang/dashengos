// apps/web/e2e/landing.spec.ts · v0.3 Phase 4 hardening
// Smoke test: landing page loads + has DaSheng OS title
// 后续可加: /login, /agents, /mcp 等页面 (需要 backend 起来)

import { test, expect } from '@playwright/test'

test.describe('landing page', () => {
  test('loads + has DaSheng OS title', async ({ page }) => {
    await page.goto('/')

    // title 含 DaSheng
    await expect(page).toHaveTitle(/DaSheng/i)

    // 有可见的 main heading
    const h1 = page.getByRole('heading', { level: 1 }).first()
    await expect(h1).toBeVisible()
  })

  test('serves a valid HTML document', async ({ page }) => {
    const response = await page.goto('/')
    expect(response).not.toBeNull()
    expect(response?.status()).toBeLessThan(400)
  })
})
