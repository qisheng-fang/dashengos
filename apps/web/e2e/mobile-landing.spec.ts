// apps/web/e2e/mobile-landing.spec.ts · v0.3 Phase 5 收官
// 移动端 smoke: 375px viewport (iPhone SE) landing 页面不破版
// 通过 test.use 在 spec 级别设 viewport (不依赖 config 的 mobile project)

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 375, height: 667 } })

test.describe('mobile landing', () => {
  test('loads + no horizontal scroll at 375px', async ({ page }) => {
    await page.goto('/')

    // title 含 DaSheng
    await expect(page).toHaveTitle(/DaSheng/i)

    // viewport 不 horizontal scroll (页面宽度 ≤ viewport 宽度 + 1px for sub-pixel)
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(dims.scrollWidth).toBeLessThanOrEqual(dims.clientWidth + 1)
  })

  test('MobileNav 隐藏 (root 是 login 重定向, 不应该显示 nav)', async ({ page }) => {
    await page.goto('/')
    // login 页不该有 bottom nav
    const nav = page.getByRole('navigation', { name: '底部导航' })
    await expect(nav).toHaveCount(0)
  })
})
