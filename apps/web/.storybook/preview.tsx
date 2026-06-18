// apps/web/.storybook/preview.tsx · 全局 Story 装饰 + 暗色背景
import type { Preview } from '@storybook/react'
import '../src/styles/globals.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0A0A0F' }, // v0.3 §30 neutral-950
        { name: 'light', value: '#FFFFFF' },
      ],
    },
    layout: 'centered',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4">
        <Story />
      </div>
    ),
  ],
}

export default preview
