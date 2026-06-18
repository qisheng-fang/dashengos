// packages/backend/src/web/index.ts · D6 (2026-06-18)
// 集中 Web Server 入口 — 仿 Hermes 集中 web_server.py
//   - status (D1)
//   - doctor (D2)
//   - providers (D3)
//   - oauth (D4)
//   - auth (D5, 单独挂在 /api/v1/auth)
//   - dashboard (D6, 聚合上面 4 块)
//
// 鉴权中间件: 公开白名单 + 受保护端点
//   公开: GET /api/status, /api/doctor, /api/v1/auth/login, /api/v1/auth/refresh
//   受保护: oauth, providers, chat, sessions, messages, automations 等

import type { FastifyInstance } from 'fastify'
import { dashboardRoutes } from './dashboard.js'

// 汇总所有 web 相关 routes
export async function webRoutes(app: FastifyInstance) {
  // D6 聚合 dashboard (D6 核心)
  await app.register(dashboardRoutes)
}

// 公开端点白名单 (D6-2 鉴权层用)
export const PUBLIC_ROUTES = [
  // D1
  'GET /api/status',
  'GET /api/v1/status',
  // D2
  'GET /api/doctor',
  'GET /api/v1/doctor',
  // D5 auth
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  // 健康检查
  'GET /health',
  'GET /healthz',
  'GET /',
  // metrics (Phase 8 公开)
  'GET /metrics',
] as const
