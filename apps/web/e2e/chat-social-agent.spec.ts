// apps/web/e2e/chat-social-agent.spec.ts · Track B + C (2026-06-15)
// 验证 Chat 屏 4 agent tab 切换 + 关键字自动路由
// 跑法:
//   1) 启 backend (cd packages/backend && pnpm dev)
//   2) 启 frontend (cd apps/web && pnpm dev)  (Playwright webServer.command 也行)
//   3) pnpm exec playwright test chat-social-agent --headed

import { test, expect } from '@playwright/test'

test.describe('Chat 屏 social agent 切换 (Track B.3 + C.1)', () => {
  test.beforeEach(async ({ page }) => {
    // 1) login (用 testuser 凭证, backend 已 seed)
    await page.goto('/login')
    await page.locator('input[name="username"]').fill('testuser')
    await page.locator('input[name="password"]').fill('test12345')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL('/', { timeout: 10_000 })
  })

  test('4 个 agent tab (default/Douyin/Xiaohongshu/Wechat) 都可见可点', async ({ page }) => {
    await page.goto('/chats/$id', { params: { id: `t_test_chat_${Date.now()}` } })

    // 4 个 agent tab
    await expect(page.locator('[data-testid="agent-tab-default"]')).toBeVisible()
    await expect(page.locator('[data-testid="agent-tab-DouyinAgent"]')).toBeVisible()
    await expect(page.locator('[data-testid="agent-tab-XiaohongshuAgent"]')).toBeVisible()
    await expect(page.locator('[data-testid="agent-tab-WechatAgent"]')).toBeVisible()

    // 初始 default 高亮
    await expect(page.locator('[data-testid="agent-tab-default"]')).toHaveAttribute('aria-selected', 'true')

    // 切到 DouyinAgent
    await page.locator('[data-testid="agent-tab-DouyinAgent"]').click()
    await expect(page.locator('[data-testid="agent-tab-DouyinAgent"]')).toHaveAttribute('aria-selected', 'true')
    // backend URL 显示
    await expect(page.locator('text=/social :8000/')).toBeVisible()
  })

  test('输入"抖音 30 秒爆款"自动切 DouyinAgent', async ({ page }) => {
    await page.goto('/chats/$id', { params: { id: `t_test_auto_${Date.now()}` } })

    const input = page.getByRole('textbox', { name: /消息输入/ })
    await input.fill('帮我做一个抖音 30 秒爆款视频')

    // draft 变化 → autoRouteAgent 触发 → activeAgent = DouyinAgent
    // 验证 tab 高亮切到 DouyinAgent
    await expect(page.locator('[data-testid="agent-tab-DouyinAgent"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 })
  })

  test('input 输入"小红书种草"切 XiaohongshuAgent, "公众号发文"切 WechatAgent', async ({ page }) => {
    await page.goto('/chats/$id', { params: { id: `t_test_auto_${Date.now()}` } })

    const input = page.getByRole('textbox', { name: /消息输入/ })

    // 1) 小红书
    await input.fill('小红书种草笔记')
    await expect(page.locator('[data-testid="agent-tab-XiaohongshuAgent"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 })

    // 2) 公众号
    await input.fill('公众号推文')
    await expect(page.locator('[data-testid="agent-tab-WechatAgent"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 })

    // 3) 无关键字 → 回到 default
    await input.fill('今天天气真好')
    await expect(page.locator('[data-testid="agent-tab-default"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 })
  })
})
