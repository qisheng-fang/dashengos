// apps/web/src/components/ui/button.stories.tsx · v0.3 spec §33 组件 Story 示例
import type { Meta, StoryObj } from '@storybook/react'
import { Mail, Loader2 } from 'lucide-react'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { children: '老板拍板', variant: 'default' },
}

export const Destructive: Story = {
  args: { children: '删除会话', variant: 'destructive' },
}

export const Loading: Story = {
  args: { children: '发消息', loading: true },
}

export const WithIcon: Story = {
  args: { children: '发邮件', leftIcon: <Mail />, variant: 'secondary' },
}

export const IconOnly: Story = {
  args: { children: <Loader2 />, size: 'icon', variant: 'ghost' },
}
