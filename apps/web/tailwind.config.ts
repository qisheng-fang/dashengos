// apps/web/tailwind.config.ts · v0.3 spec 附录 F (UI 设计 token 完整表)
// ⚠️ 这是单一来源 — CSS variables 也从这里读

import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class', 'class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
  	extend: {
  		colors: {
  			brand: {
  				DEFAULT: '#FF6B35',
  				hover: '#FF8559'
  			},
  			secondary: '#1A1A2E',
  			semantic: {
  				// v0.3 PR7: 暗色主题 — 用 -400 阶 (brighter) 保证 bg-/10/20 上的 text- 4.5:1 对比度
  				success: '#34D399',
  				warning: '#FBBF24',
  				danger: '#F87171',
  				info: '#60A5FA'
  			},
  			neutral: {
  				'0': '#FFFFFF',
  				'50': '#F9FAFB',
  				'100': '#F3F4F6',
  				'200': '#E5E7EB',
  				'300': '#D1D5DB',
  				'400': '#9CA3AF',
  				'500': '#6B7280',
  				'600': '#4B5563',
  				'700': '#374151',
  				'800': '#1F2937',
  				'900': '#111827',
  				'950': '#0A0A0F'
  			},
  			llm: {
  				thinking: '#A78BFA',
  				toolCall: '#FBBF24',
  				completed: '#10B981',
  				errored: '#EF4444',
  				aborted: '#6B7280'
  			}
  		},
  		fontFamily: {
  			sans: [
  				'Inter',
  				'PingFang SC',
  				'Hiragino Sans GB',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'Menlo',
  				'Consolas',
  				'monospace'
  			]
  		},
  		fontSize: {
  			xs: [
  				'12px',
  				{
  					lineHeight: '16px'
  				}
  			],
  			sm: [
  				'13px',
  				{
  					lineHeight: '18px'
  				}
  			],
  			base: [
  				'14px',
  				{
  					lineHeight: '20px'
  				}
  			],
  			lg: [
  				'16px',
  				{
  					lineHeight: '24px'
  				}
  			],
  			xl: [
  				'18px',
  				{
  					lineHeight: '28px'
  				}
  			],
  			'2xl': [
  				'22px',
  				{
  					lineHeight: '32px'
  				}
  			],
  			'3xl': [
  				'28px',
  				{
  					lineHeight: '36px'
  				}
  			],
  			'4xl': [
  				'36px',
  				{
  					lineHeight: '44px'
  				}
  			]
  		},
  		spacing: {
  			'4.5': '18px',
  			'5.5': '22px'
  		},
  		borderRadius: {
  			sm: '4px',
  			md: '8px',
  			lg: '12px',
  			xl: '16px'
  		},
  		boxShadow: {
  			sm: '0 1px 2px rgba(0,0,0,0.05)',
  			md: '0 4px 6px rgba(0,0,0,0.1)',
  			lg: '0 10px 15px rgba(0,0,0,0.1)',
  			xl: '0 20px 25px rgba(0,0,0,0.15)'
  		},
  		zIndex: {
  			dropdown: '1000',
  			sticky: '1020',
  			modal: '1040',
  			popover: '1060',
  			toast: '1080',
  			command: '1100'
  		},
  		transitionDuration: {
  			fast: '150ms',
  			base: '250ms',
  			slow: '400ms'
  		},
  		transitionTimingFunction: {
  			spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
  		},
  		screens: {
  			mobile: '0px',
  			tablet: '768px',
  			desktop: '1280px',
  			wide: '1920px'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [],
}

export default config
