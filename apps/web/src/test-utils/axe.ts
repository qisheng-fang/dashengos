// apps/web/src/test-utils/axe.ts · v0.3 PR7 a11y 测试工具
// 用 axe-core 直接跑, 不引入 vitest-axe 避免多一个 dep
// 用法: import { axe } from './test-utils/axe'; test('a11y', async () => { ... })

import { expect, vi, beforeAll, afterAll } from 'vitest'
// axe-core v4.12 用 `export = axe` (CJS 风格), Vite ESM 解析时拿到 default export
import axeDefault, { type Result, type Spec, type RunOptions, type AxeResults } from 'axe-core'

// 抑制 a11y 错误在 console 出现, 我们自己用 expect 处理
const originalError = console.error
beforeAll(() => {
  console.error = vi.fn((...args) => {
    const msg = String(args[0] ?? '')
    if (msg.includes('axe') || msg.includes('a11y') || msg.includes('accessibility')) return
    originalError(...args)
  })
})
afterAll(() => {
  console.error = originalError
})

export interface AxeOptions {
  /**
   * axe rules to run. Defaults to wcag2a + wcag2aa + best-practice + section508
   */
  runOptions?: Spec
  /**
   * Skip these rules (e.g. 'color-contrast' for jsdom tests that can't compute colors)
   */
  rules?: Record<string, { enabled: boolean }>
}

const DEFAULT_RULES: Record<string, { enabled: boolean }> = {
  // jsdom 里 getComputedStyle 返回的都是 0, 颜色对比检查跑不动
  'color-contrast': { enabled: false },
}

type AxeRunner = (context: Element, options: RunOptions) => Promise<AxeResults>

/**
 * Run axe against a rendered component. Returns violations filtered to critical/serious.
 * Throws (via expect) if any critical/serious violations found.
 *
 * Example:
 *   test('Login is accessible', async () => {
 *     const { container } = render(<Login />)
 *     await expectNoCriticalA11y(container)
 *   })
 */
export async function expectNoCriticalA11y(
  container: Element,
  opts: AxeOptions = {},
): Promise<Result[]> {
  // axe-core v4.12 ESM interop: default export may be wrapped
  const axe: AxeRunner = (axeDefault as unknown as { run: AxeRunner }).run
    ?? (axeDefault as unknown as AxeRunner)

  const rules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) }
  const results = await axe(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules,
    resultTypes: ['violations'],
    ...(opts.runOptions as unknown as RunOptions ?? {}),
  })

  const critical = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  )

  if (critical.length > 0) {
    const summary = critical
      .map(
        (v) =>
          `  ❌ [${v.impact}] ${v.id}: ${v.description}\n` +
          v.nodes
            .slice(0, 2)
            .map((n) => `     → ${n.target.join(' ')} (${n.failureSummary?.split('\n')[0]})`)
            .join('\n'),
      )
      .join('\n\n')
    expect.fail(`Found ${critical.length} critical/serious a11y violation(s):\n\n${summary}`)
  }

  return results.violations
}

/**
 * Re-export RTL render so test files can import everything from one place.
 */
export { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
export { userEvent } from '@testing-library/user-event'


