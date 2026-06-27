// packages/backend/src/core/browser.ts · Phase A.3 (2026-06-17)
// Playwright 浏览器自动化核心：JS 渲染、截图、表单填充、Cookie 注入
// 懒加载单例 Chromium 实例，未安装时优雅降级

import type { Browser, Page } from 'playwright'

// ─── 浏览器端 JS 片段 (字符串求值, 避免 TS DOM lib 依赖) ────────

const EXTRACT_TEXT_JS = `(() => {
  const el = document.body || document.documentElement;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
  return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
})()`

const EXTRACT_SELECTOR_JS = (sel: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  return el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
})()`

// ─── Types ─────────────────────────────────────────────────────────

export interface BrowserResult {
  url: string
  title: string
  html: string      // 截断到 500KB
  text: string      // 提取的文本
  statusCode: number
  durationMs: number
}

export interface NavigateOptions {
  cookies?: string           // Cookie 字符串 "k1=v1; k2=v2"
  waitFor?: string            // 等某个 selector 出现
  timeout?: number            // 毫秒，默认 30000
}

export interface ScreenshotOptions {
  fullPage?: boolean
  clip?: { x: number; y: number; width: number; height: number }
}

export interface BrowserStatus {
  available: boolean
  reason?: string
}

// ─── 懒加载单例 ─────────────────────────────────────────────────

let _browser: Browser | null = null
let _initError: string | null = null
let _initPromise: Promise<void> | null = null

/**
 * 懒初始化 Chromium 浏览器实例。
 * 首次调用时创建，后续复用同一实例。
 */
async function ensureBrowser(): Promise<Browser> {
  // 已初始化成功
  if (_browser && _browser.isConnected()) return _browser

  // 有缓存的错误
  if (_initError) throw new Error(_initError)

  // 正在初始化中，等它完成
  if (_initPromise) {
    await _initPromise
    return ensureBrowser()
  }

  // 开始初始化
  _initPromise = (async () => {
    try {
      // 动态 import playwright（npm 包未安装时这里会直接失败）
      const { chromium } = await import('playwright')

      _browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? String(err)
      // 区分 "未安装" 和 "其他错误"
      if (msg.includes('Cannot find module') || msg.includes("executable doesn't exist")) {
        _initError = 'Playwright browser not installed. Run: npx playwright install chromium'
      } else if (msg.includes('browserType.launch')) {
        _initError = 'Playwright browser binary not found. Run: npx playwright install chromium'
      } else {
        _initError = `Playwright init failed: ${msg.slice(0, 200)}`
      }
      throw new Error(_initError)
    }
  })()

  try {
    await _initPromise
    return _browser!
  } catch {
    _initPromise = null
    throw new Error(_initError!)
  }
}

// ─── Cookie 工具 ────────────────────────────────────────────────

/**
 * 将 Cookie 字符串 "k1=v1; k2=v2" 解析为 Playwright cookie 对象数组
 */
function parseCookieString(cookieStr: string, domain: string): Array<{
  name: string
  value: string
  domain: string
  path: string
}> {
  return cookieStr.split(';').map((part) => {
    const [name, ...rest] = part.trim().split('=')
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain,
      path: '/',
    }
  }).filter((c) => c.name)
}

/**
 * 从 URL 提取主域名
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ─── 核心方法 ──────────────────────────────────────────────────

/**
 * 导航到页面，返回 HTML + 文本 + 标题
 */
export async function navigate(
  url: string,
  options?: NavigateOptions,
): Promise<BrowserResult> {
  const t0 = Date.now()
  const browser = await ensureBrowser()
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3 (research-agent)',
  })

  let page: Page | null = null
  try {
    page = await context.newPage()

    // 注入 Cookie
    if (options?.cookies) {
      const domain = extractDomain(url)
      const cookies = parseCookieString(options.cookies, domain)
      await context.addCookies(cookies)
    }

    // 导航
    const response = await page.goto(url, {
      waitUntil: options?.waitFor ? 'load' : 'domcontentloaded',
      timeout: options?.timeout ?? 30_000,
    })

    const statusCode = response?.status() ?? 200

    // 等指定 selector
    if (options?.waitFor) {
      try {
        await page.waitForSelector(options.waitFor, { timeout: 10_000 })
      } catch {
        // selector 未出现 — 不阻塞，已经拿到 DOM
      }
    }

    const title = await page.title()
    const html = await page.content()
    const text = (await page.evaluate(EXTRACT_TEXT_JS)) as string

    const truncatedHtml = html.length > 500_000 ? html.slice(0, 500_000) + '\n<!-- truncated -->' : html

    return {
      url,
      title,
      html: truncatedHtml,
      text: text.slice(0, 100_000),
      statusCode,
      durationMs: Date.now() - t0,
    }
  } finally {
    if (page) {
      try { await page.close() } catch { /* ignore */ }
    }
    try { await context.close() } catch { /* ignore */ }
  }
}

/**
 * 页面截图，返回 PNG buffer
 */
export async function screenshot(
  url: string,
  options?: ScreenshotOptions,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const browser = await ensureBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3',
  })

  let page: Page | null = null
  try {
    page = await context.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

    const screenshotOptions: Parameters<Page['screenshot']>[0] = {
      type: 'png',
      fullPage: options?.fullPage ?? true,
    }
    if (options?.clip) {
      screenshotOptions.clip = options.clip
      screenshotOptions.fullPage = false
    }

    const buffer = await page.screenshot(screenshotOptions)
    return { buffer, mimeType: 'image/png' }
  } finally {
    if (page) {
      try { await page.close() } catch { /* ignore */ }
    }
    try { await context.close() } catch { /* ignore */ }
  }
}

/**
 * 提取页面文本内容
 */
export async function extract(
  url: string,
  selector?: string,
): Promise<string> {
  const browser = await ensureBrowser()
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3',
  })

  let page: Page | null = null
  try {
    page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const text = (selector
      ? await page.evaluate(EXTRACT_SELECTOR_JS(selector))
      : await page.evaluate(EXTRACT_TEXT_JS)) as string

    return text.slice(0, 100_000)
  } finally {
    if (page) {
      try { await page.close() } catch { /* ignore */ }
    }
    try { await context.close() } catch { /* ignore */ }
  }
}

/**
 * 填充表单并提交
 */
export async function fillForm(
  url: string,
  fields: Record<string, string>,
  submitSelector?: string,
): Promise<BrowserResult> {
  const t0 = Date.now()
  const browser = await ensureBrowser()
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3',
  })

  let page: Page | null = null
  try {
    page = await context.newPage()
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const statusCode = response?.status() ?? 200

    // 填充每个字段
    for (const [sel, value] of Object.entries(fields)) {
      await page.waitForSelector(sel, { timeout: 10_000 })
      await page.fill(sel, String(value))
    }

    // 提交
    if (submitSelector) {
      await page.click(submitSelector)
      await page.waitForLoadState('networkidle', { timeout: 15_000 })
    }

    const title = await page.title()
    const html = await page.content()
    const text = (await page.evaluate(EXTRACT_TEXT_JS)) as string

    const truncatedHtml = html.length > 500_000 ? html.slice(0, 500_000) + '\n<!-- truncated -->' : html

    return {
      url: page.url(),
      title,
      html: truncatedHtml,
      text: text.slice(0, 100_000),
      statusCode,
      durationMs: Date.now() - t0,
    }
  } finally {
    if (page) {
      try { await page.close() } catch { /* ignore */ }
    }
    try { await context.close() } catch { /* ignore */ }
  }
}

/**
 * 抓取 JS 渲染后的页面内容（不同于静态 HTML 抓取）
 * 用于需要 JS 执行才能看到内容的网站（如抖音、小红书等）
 */
export async function fetchRenderedPage(
  url: string,
  options?: {
    cookies?: string
    waitMs?: number
    timeout?: number
  },
): Promise<{ html: string; text: string; title: string; statusCode: number }> {
  const browser = await ensureBrowser()
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3',
  })

  let page: Page | null = null
  try {
    page = await context.newPage()

    if (options?.cookies) {
      const domain = extractDomain(url)
      const cookies = parseCookieString(options.cookies, domain)
      await context.addCookies(cookies)
    }

    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: options?.timeout ?? 30_000,
    })

    // 额外等待 JS 渲染
    if (options?.waitMs) {
      await page.waitForTimeout(options.waitMs)
    }

    const statusCode = response?.status() ?? 200
    const title = await page.title()
    const html = await page.content()
    const text = (await page.evaluate(EXTRACT_TEXT_JS)) as string

    return {
      html: html.length > 500_000 ? html.slice(0, 500_000) + '\n<!-- truncated -->' : html,
      text: text.slice(0, 100_000),
      title,
      statusCode,
    }
  } finally {
    if (page) {
      try { await page.close() } catch { /* ignore */ }
    }
    try { await context.close() } catch { /* ignore */ }
  }
}

/**
 * 检查浏览器是否可用（不启动）
 */
export function getStatus(): BrowserStatus {
  if (_initError) return { available: false, reason: _initError }
  if (_browser?.isConnected()) return { available: true }
  return { available: true, reason: 'browser not yet initialized (lazy)' }
}

/**
 * 关闭浏览器实例（优雅关闭时调用）
 */
export async function close(): Promise<void> {
  if (_browser) {
    try {
      await _browser.close()
    } catch {
      // force close
    }
    _browser = null
  }
  _initError = null
  _initPromise = null
}

/**
 * 根据平台自动注入 Cookie
 * 抖音(douyin)、小红书(xiaohongshu)、微信(wechat) 等社媒平台
 */
export function autoInjectCookies(
  url: string,
  cookieMap: Record<string, string>,
): string | undefined {
  const domain = extractDomain(url).toLowerCase()

  // 社媒平台 → cookie key 映射
  const PLATFORM_COOKIES: Record<string, string> = {
    douyin: 'douyin',
    'www.douyin.com': 'douyin',
    xiaohongshu: 'xiaohongshu',
    'www.xiaohongshu.com': 'xiaohongshu',
    xhslink: 'xiaohongshu',
    weixin: 'wechat',
    'mp.weixin.qq.com': 'wechat',
    wechat: 'wechat',
  }

  for (const [key, platform] of Object.entries(PLATFORM_COOKIES)) {
    if (domain.includes(key)) {
      return cookieMap[platform]
    }
  }

  return undefined
}


// ═══ v8.5: Browser Agent Loop + standalone click/evaluate ═══

/**
 * 独立 click 操作 — 点击页面元素
 */
export async function click(
  url: string,
  selector: string,
  options?: { cookies?: string; timeout?: number }
): Promise<{ success: boolean; text: string; durationMs: number; error?: string }> {
  const t0 = Date.now()
  try {
    const browser = await ensureBrowser()
    const page = await browser.newPage()
    try {
      if (options?.cookies) {
        const domain = extractDomain(url)
        await page.context().addCookies(parseCookieString(options.cookies, domain))
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options?.timeout || 30000 })
      await page.waitForSelector(selector, { timeout: 10000 })
      await page.click(selector)
      await page.waitForTimeout(500)
      const text = (await page.evaluate(EXTRACT_TEXT_JS)) as string
      return { success: true, text: text.slice(0, 10000), durationMs: Date.now() - t0 }
    } finally {
      await page.close()
    }
  } catch (e: any) {
    return { success: false, text: '', durationMs: Date.now() - t0, error: e.message }
  }
}

/**
 * 执行任意 JavaScript — evaluate
 */
export async function evaluate(
  url: string,
  jsCode: string,
  options?: { cookies?: string; timeout?: number }
): Promise<{ success: boolean; result: any; durationMs: number; error?: string }> {
  const t0 = Date.now()
  try {
    const browser = await ensureBrowser()
    const page = await browser.newPage()
    try {
      if (options?.cookies) {
        const domain = extractDomain(url)
        await page.context().addCookies(parseCookieString(options.cookies, domain))
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options?.timeout || 30000 })
      const result = await page.evaluate(jsCode)
      return { success: true, result, durationMs: Date.now() - t0 }
    } finally {
      await page.close()
    }
  } catch (e: any) {
    return { success: false, result: null, durationMs: Date.now() - t0, error: e.message }
  }
}

/**
 * 快照 — 同时返回 DOM 文本 + 截图 base64
 */
export async function snapshot(
  url: string,
  options?: { cookies?: string; timeout?: number }
): Promise<{ success: boolean; url: string; title: string; text: string; screenshotBase64?: string; durationMs: number; error?: string }> {
  const t0 = Date.now()
  try {
    const browser = await ensureBrowser()
    const page = await browser.newPage()
    try {
      if (options?.cookies) {
        const domain = extractDomain(url)
        await page.context().addCookies(parseCookieString(options.cookies, domain))
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options?.timeout || 30000 })
      const title = await page.title()
      const text = (await page.evaluate(EXTRACT_TEXT_JS)) as string
      const shot = await page.screenshot({ type: 'png', fullPage: false })
      return {
        success: true, url, title,
        text: text.slice(0, 50000),
        screenshotBase64: shot.toString('base64'),
        durationMs: Date.now() - t0,
      }
    } finally {
      await page.close()
    }
  } catch (e: any) {
    return { success: false, url, title: '', text: '', durationMs: Date.now() - t0, error: e.message }
  }
}

/**
 * Browser Agent Loop — think → act → observe → repeat
 */
export interface AgentStep { action: string; selector?: string; value?: string; result: string }
export interface AgentLoopResult { success: boolean; steps: AgentStep[]; finalSnapshot: string; durationMs: number }

export async function browserAgentLoop(
  task: string,
  startUrl: string,
  maxSteps = 5,
  options?: { cookies?: string; timeout?: number }
): Promise<AgentLoopResult> {
  const t0 = Date.now()
  const steps: AgentStep[] = []

  try {
    const browser = await ensureBrowser()
    const page = await browser.newPage()
    try {
      if (options?.cookies) {
        const domain = extractDomain(startUrl)
        await page.context().addCookies(parseCookieString(options.cookies, domain))
      }
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: options?.timeout || 30000 })

      for (let i = 0; i < maxSteps; i++) {
        const _text = (await page.evaluate(EXTRACT_TEXT_JS)) as string; void _text

        // Simple heuristic agent:
        // Extract links, try to find task-related content
        const links = await page.evaluate(`(() => {
          var all = document.querySelectorAll('a[href]');
          var result = [];
          for (var i = 0; i < Math.min(all.length, 20); i++) {
            var a = all[i];
            result.push({ text: (a.innerText || '').trim().slice(0, 50), href: a.href });
          }
          return result;
        })()`) as Array<{ text: string; href: string }>

        // Find most relevant link
        const taskKeywords = task.toLowerCase().split(/\s+/).filter(w => w.length > 2)
        const bestLink = links.find(l =>
          taskKeywords.some(kw => l.text.toLowerCase().includes(kw) || l.href.toLowerCase().includes(kw))
        )

        if (bestLink) {
          await page.click('a[href="' + bestLink.href + '"]')
          await page.waitForTimeout(1000)
          const newText = (await page.evaluate(EXTRACT_TEXT_JS)) as string
          steps.push({ action: 'click', selector: bestLink.href, result: newText.slice(0, 200) })
        } else {
          // No more relevant links — search
          const searchInputs = await page.evaluate(`(() => {
            var all = document.querySelectorAll('input[type="text"], input[type="search"], input[name*="search"], input[name*="q"]');
            var result = [];
            for (var i = 0; i < all.length; i++) {
              var el = all[i];
              result.push({ tag: el.tagName, type: el.type, name: el.name });
            }
            return result;
          })()`) as Array<{ tag: string; type: string; name: string }>
          if (searchInputs.length > 0) {
            const sel = searchInputs[0].name ? 'input[name="' + searchInputs[0].name + '"]' : 'input[type="text"]'
            await page.fill(sel, task)
            await page.keyboard.press('Enter')
            await page.waitForTimeout(2000)
            const searchText = (await page.evaluate(EXTRACT_TEXT_JS)) as string
            steps.push({ action: 'search', value: task, result: searchText.slice(0, 200) })
          }
          break
        }
      }

      const finalText = (await page.evaluate(EXTRACT_TEXT_JS)) as string
      return { success: true, steps, finalSnapshot: finalText.slice(0, 5000), durationMs: Date.now() - t0 }
    } finally {
      await page.close()
    }
  } catch (e: any) {
    return { success: false, steps, finalSnapshot: '', durationMs: Date.now() - t0 }
  }
}

/**
 * Check Playwright availability
 */
export function getBrowserStatus(): BrowserStatus {
  if (_browser?.isConnected()) return { available: true }
  if (_initError) return { available: false, reason: _initError }
  return { available: false, reason: 'Not initialized — call navigate/screenshot first' }
}
