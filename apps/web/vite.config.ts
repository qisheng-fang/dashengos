import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // v0.3 PR7: 开启 sourcemap 让 lhci valid-source-maps 通过 + 调试可用
    sourcemap: true,
    // 拆分 recharts 等大依赖, 让 main chunk ≤ 500kB
    rollupOptions: {
      output: {
        manualChunks: {
          tanstack: ['@tanstack/react-router', '@tanstack/react-query'],
          radix: [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select',
            '@radix-ui/react-switch',
            '@radix-ui/react-slider',
            '@radix-ui/react-accordion',
            '@radix-ui/react-toast',
            '@radix-ui/react-progress',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-separator',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-label',
            '@radix-ui/react-avatar',
            '@radix-ui/react-slot',
          ],
          charts: ['recharts'],
          'syntax-highlight': ['shiki'],
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: '127.0.0.1', // v0.3 spec §6.4: 强约束 127.0.0.1
    proxy: {
      // API 代理: 前端 /api → 后端 :8000 (避免浏览器走系统 proxy)
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      // Agent Bridge 代理: 前端 /agent → :8001 (strip /agent prefix)
      '/agent': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
        rewrite: (p: string) => p.replace(/^\/agent/, ''),
      },
    },
  },
  preview: {
    port: 3000,
    host: '127.0.0.1',
  },
})
