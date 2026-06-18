// apps/web/src/components/ui/button.test.tsx · Vitest 验证 v0.3 spec §33.2
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Mail } from 'lucide-react'
import { Button } from './button'

describe('Button · v0.3 spec §33.2', () => {
  it('renders children', () => {
    render(<Button>老板拍板</Button>)
    expect(screen.getByRole('button', { name: '老板拍板' })).toBeInTheDocument()
  })

  it('handles click', async () => {
    let clicked = false
    render(<Button onClick={() => (clicked = true)}>点我</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(clicked).toBe(true)
  })

  it('is disabled when loading and has aria-busy', () => {
    render(<Button loading>加载中</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('renders leftIcon / rightIcon when not loading', () => {
    render(
      <Button leftIcon={<Mail data-testid="li" />} rightIcon={<span data-testid="ri">→</span>}>
        发邮件
      </Button>,
    )
    expect(screen.getByTestId('li')).toBeInTheDocument()
    expect(screen.getByTestId('ri')).toBeInTheDocument()
  })

  it('hides icons when loading (only spinner shown)', () => {
    render(
      <Button loading leftIcon={<Mail data-testid="li" />}>
        发邮件
      </Button>,
    )
    expect(screen.queryByTestId('li')).not.toBeInTheDocument()
  })

  it('applies brand color on default variant', () => {
    render(<Button>老板</Button>)
    const btn = screen.getByRole('button')
    expect(btn.className).toMatch(/bg-brand/)
  })
})
