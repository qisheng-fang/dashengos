// apps/web/playwright.config.ts · v0.3 Phase 4 hardening
// Playwright E2E config (item #3 from 老板工作清单)
//
// 跑法:
//   pnpm e2e:install    # 第一次: 装 chromium (~120MB)
//   pnpm e2e            # 跑测试
//   pnpm exec playwright test --ui   # UI 模式
//
// CI: .github/workflows/e2e.yml 自动跑

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm preview',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
