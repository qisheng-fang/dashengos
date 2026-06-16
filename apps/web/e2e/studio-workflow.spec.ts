// apps/web/e2e/studio-workflow.spec.ts · Track C.2 (2026-06-15)
// 验证 ComfyUI 式 Studio: NodePalette 7 类节点 + 3 模板 + 画布可运行
// 跑法: backend (8000) + frontend (3000) 起来后跑

import { test, expect } from '@playwright/test'

test.describe('Studio ComfyUI 工作流编辑器 (Track C.2)', () => {
  test.beforeEach(async ({ page }) => {
    // login
    await page.goto('/login')
    await page.locator('input[name="username"]').fill('testuser')
    await page.locator('input[name="password"]').fill('test12345')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL('/', { timeout: 10_000 })
  })

  test('Studio 屏 3 栏布局 + 7 类节点 + 3 模板按钮', async ({ page }) => {
    await page.goto('/studio')
    await expect(page.locator('[data-testid="studio-page"]')).toBeVisible()
    // NodePalette 7 类
    await expect(page.locator('[data-testid="palette-douyin"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-xiaohongshu"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-wechat"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-video_gen"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-video_parse"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-content"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-data_crawl"]')).toBeVisible()
    // 3 模板
    await expect(page.locator('[data-testid="tpl-0"]')).toBeVisible()
    await expect(page.locator('[data-testid="tpl-1"]')).toBeVisible()
    await expect(page.locator('[data-testid="tpl-2"]')).toBeVisible()
  })

  test('加载抖音爆款模板 → 3 节点自动出现在画布 → 运行成功', async ({ page }) => {
    await page.goto('/studio')
    await page.locator('[data-testid="tpl-0"]').click()  // 抖音爆款流水线
    // 3 节点 (content / video_gen / douyin) 出现在画布
    await expect(page.locator('[data-testid="studio-node-content"]')).toBeVisible()
    await expect(page.locator('[data-testid="studio-node-video_gen"]')).toBeVisible()
    await expect(page.locator('[data-testid="studio-node-douyin"]')).toBeVisible()
    // 画布里有 2 条边 (BFS 跑过去触发 3 节点)
    // 运行
    await page.locator('[data-testid="studio-run"]').click()
    // WorkflowRunner 进度条出现
    await expect(page.locator('[data-testid="studio-progress"]')).toBeVisible()
    // 等 douyin 节点 (最后跑) status = success
    await expect(page.locator('[data-testid="studio-node-douyin"][data-status="success"]')).toBeVisible({ timeout: 10_000 })
  })

  test('Workspace 侧边栏 Studio 入口可见可点', async ({ page }) => {
    await page.goto('/')
    // Sidebar Studio link
    await expect(page.locator('a[href="/studio"]')).toBeVisible()
    await page.locator('a[href="/studio"]').first().click()
    await page.waitForURL('/studio', { timeout: 5_000 })
  })
})
