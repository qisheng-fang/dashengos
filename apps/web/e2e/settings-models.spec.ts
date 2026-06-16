// apps/web/e2e/settings-models.spec.ts · Track C.3 (2026-06-15)
// 验证多模态路由 3 子页 (text/multimodal/provider) + Settings Outlet
// 跑法: backend (8000) + frontend (3000) 起来后跑

import { test, expect } from '@playwright/test'

test.describe('Settings 多模态路由 3 页 (Track C.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[name="username"]').fill('testuser')
    await page.locator('input[name="password"]').fill('test12345')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL('/', { timeout: 10_000 })
  })

  test('Settings 屏模型路由跳 /settings/models/text (3-tab nav + Outlet)', async ({ page }) => {
    await page.goto('/settings')
    // 子 nav "模型路由" 跳到 /settings/models/text (3 子页默认)
    await page.waitForURL(/\/settings\/models\//, { timeout: 5_000 })
    // 3-tab 切换
    await expect(page.locator('[data-testid="models-tab-text"]')).toBeVisible()
    await expect(page.locator('[data-testid="models-tab-multimodal"]')).toBeVisible()
    await expect(page.locator('[data-testid="models-tab-provider"]')).toBeVisible()
    // Outlet 渲染 text page
    await expect(page.locator('[data-testid="text-models-page"]')).toBeVisible()
    // 降级链显示 (chain-row-0 = Qwen2.5-7B Ollama, chain-row-1 = DeepSeek)
    await expect(page.locator('[data-testid="chain-row-0"]')).toBeVisible()
    await expect(page.locator('[data-testid="chain-row-1"]')).toBeVisible()
  })

  test('切到 multimodal 页 5 模态组 (图像/视频/音频/TTS/音乐)', async ({ page }) => {
    await page.goto('/settings/models/multimodal')
    await expect(page.locator('[data-testid="multimodal-models-page"]')).toBeVisible()
    // 至少 5 模态分组 (image / video / audio / tts / music)
    // 验证关键模型可见
    await expect(page.locator('[data-testid="multimodal-model-sd-xl"]')).toBeVisible()
    await expect(page.locator('[data-testid="multimodal-model-pixelle"]')).toBeVisible()
    await expect(page.locator('[data-testid="multimodal-model-whisper"]')).toBeVisible()
  })

  test('切到 provider 页 5 厂商 + Key 配置', async ({ page }) => {
    await page.goto('/settings/models/provider')
    await expect(page.locator('[data-testid="provider-page"]')).toBeVisible()
    // 5 厂商
    await expect(page.locator('[data-testid="key-edit-deepseek"]')).toBeVisible()
    await expect(page.locator('[data-testid="key-edit-siliconflow"]')).toBeVisible()
    await expect(page.locator('[data-testid="key-edit-openai"]')).toBeVisible()
    await expect(page.locator('[data-testid="key-edit-anthropic"]')).toBeVisible()
    await expect(page.locator('[data-testid="key-edit-ollama"]')).toBeVisible()
    // 测试连接按钮
    await expect(page.locator('[data-testid="test-provider-ollama"]')).toBeVisible()
  })

  test('Workspace → Settings 路径显示 套餐 & 用量 + 模型路由 Outlet', async ({ page }) => {
    await page.goto('/settings')
    // 套餐 & 用量 Card 保留 (从 inline 拆后)
    await expect(page.locator('text=/订阅套餐/')).toBeVisible({ timeout: 5_000 })
    // 模型路由 Outlet (默认走 text)
    await expect(page.locator('[data-testid="models-layout"]')).toBeVisible()
  })
})
