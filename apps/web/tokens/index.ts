// apps/web/tokens/index.ts · v0.3 spec §30.2 (设计 token 完整表)
// ⚠️ 这是单一来源 — Tailwind config + CSS variables 都从这里读

export const tokens = {
  color: {
    // 品牌色
    brand: {
      primary: '#FF6B35', // 爱尤趣暖橙
      primaryHover: '#FF8559',
      secondary: '#1A1A2E', // 深空蓝
    },
    // 语义色
    semantic: {
      success: '#10B981',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#3B82F6',
    },
    // 中性色（暗色优先）
    neutral: {
      0: '#FFFFFF',
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      400: '#9CA3AF',
      500: '#6B7280',
      600: '#4B5563',
      700: '#374151',
      800: '#1F2937',
      900: '#111827',
      950: '#0A0A0F', // 暗色背景
    },
    // LLM 状态色（用于流式消息）
    llm: {
      thinking: '#A78BFA', // 紫
      toolCall: '#FBBF24', // 黄
      completed: '#10B981', // 绿
      errored: '#EF4444', // 红
      aborted: '#6B7280', // 灰
    },
  },
  font: {
    sans: 'Inter, "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
    mono: '"JetBrains Mono", Menlo, Consolas, monospace',
    size: {
      xs: '12px',
      sm: '13px',
      base: '14px',
      lg: '16px',
      xl: '18px',
      '2xl': '22px',
      '3xl': '28px',
      '4xl': '36px',
    },
    weight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
  space: {
    0: '0',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
    16: '64px',
  },
  radius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 6px rgba(0,0,0,0.1)',
    lg: '0 10px 15px rgba(0,0,0,0.1)',
    xl: '0 20px 25px rgba(0,0,0,0.15)',
  },
  breakpoint: {
    mobile: '0px', // < 768
    tablet: '768px', // 768-1280
    desktop: '1280px', // 1280-1920
    wide: '1920px', // > 1920
  },
  zIndex: {
    dropdown: 1000,
    sticky: 1020,
    modal: 1040,
    popover: 1060,
    toast: 1080,
    command: 1100, // Cmd+K 面板
  },
  motion: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    base: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '400ms cubic-bezier(0.4, 0, 0.2, 1)',
    spring: '500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const

export type Tokens = typeof tokens
