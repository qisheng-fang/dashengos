# apps/web · DaShengOS 私有 AI 工作台前端

> **栈**: Vite 6 + React 19 + TypeScript 5.7 + Tailwind 3.4 + shadcn/ui + Radix + Zustand + TanStack Router/Query + react-i18next + Framer Motion + Lucide + Vitest + Storybook
> **Spec**: v0.3 §30-34 (UI 设计 + 状态/路由/i18n)
> **Phase**: PR1 脚手架 ✅ (2026-06-15)

## 跑起来

```bash
# 1. 装 pnpm (一次)
corepack enable && corepack prepare pnpm@9.15.0 --activate

# 2. 装依赖
cd /Users/apple/Desktop/ai-workbench-v2
pnpm install

# 3. 起 dev server
pnpm dev
# → http://127.0.0.1:3000
```

## 跑测试

```bash
pnpm test           # Vitest 单元
pnpm storybook      # 25 组件库预览 (http://localhost:6006)
pnpm a11y           # axe-core 0 critical
pnpm perf           # Lighthouse ≥90
```

## 目录

```
apps/web/
├── components.json       # shadcn/ui config
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.ts    # v0.3 附录 F token
├── tokens/index.ts       # v0.3 §30.2 token (TS)
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts        # Vite + TanStack Router plugin
└── src/
    ├── main.tsx          # React 19 入口
    ├── routeTree.gen.ts  # TanStack Router 自动生成
    ├── routes/           # 文件式路由
    │   ├── __root.tsx
    │   └── index.tsx     # Workspace 空态 (Phase 1 PR1 stub)
    ├── styles/globals.css
    ├── lib/cn.ts         # className helper
    ├── test-setup.ts
    └── vite-env.d.ts
```

## 5 设计原则 (v0.3 §30.1)

1. **本地优先感** · 任何云端资源必须明示
2. **可审计感** · 关键操作 2 步确认 + 1 步审计
3. **键盘可达** · Tab/Shift+Tab/Enter/Esc/Cmd+K
4. **暗色优先** · dark 默认, system 跟随, light 可选
5. **零营销文案** · 不出现「立即升级」「尊享会员」
