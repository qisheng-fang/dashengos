// apps/web/tailwind.config.ts · DaShengOS v8.5
// CSS variables 驱动 · 日夜自适应 · rem 字号

import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class', 'class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
        },
        secondary: 'var(--bg-tertiary)',
        semantic: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
        },
        neutral: {
          '0': 'var(--text-primary)',
          '50': 'var(--bg-secondary)',
          '100': 'var(--text-primary)',
          '200': 'var(--border)',
          '300': 'var(--text-secondary)',
          '400': 'var(--text-soft)',
          '500': 'var(--text-muted)',
          '600': 'var(--text-muted)',
          '700': 'var(--bg-tertiary)',
          '800': 'var(--bg-secondary)',
          '900': 'var(--bg-primary)',
          '950': '#050710',
        },
        llm: {
          thinking: '#A78BFA',
          toolCall: 'var(--brand)',
          completed: 'var(--success)',
          errored: 'var(--danger)',
          aborted: 'var(--text-muted)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      spacing: {
        '4.5': '1.125rem',
        '5.5': '1.375rem',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 4px 6px rgba(0,0,0,0.1)',
        lg: '0 10px 15px rgba(0,0,0,0.1)',
        xl: '0 20px 25px rgba(0,0,0,0.15)',
      },
      zIndex: {
        dropdown: '1000',
        sticky: '1020',
        modal: '1040',
        popover: '1060',
        toast: '1080',
        command: '1100',
      },
      transitionDuration: {
        fast: '150ms',
        base: '250ms',
        slow: '400ms',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      screens: {
        mobile: '0px',
        tablet: '768px',
        desktop: '1280px',
        wide: '1920px',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
