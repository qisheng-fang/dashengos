// packages/backend/src/core/metrics.ts · v0.3 spec §19 (Prometheus metrics)
//
// Phase 8: 统一 prom-client Registry + 业务 counters/histograms.
// 所有路由通过 import { metrics } 计数; server.ts 注册 /metrics 端点.
// Cardinality 控制: labelNames 只用 {result/scope/tier/provider/type/method/route/status},
//   绝不放 user_id / session_id / request_id 这种 unbounded label.

import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client'

export const registry = new Registry()
collectDefaultMetrics({ register: registry })

export const metrics = {
  // 业务 counters
  authLogin: new Counter({
    name: 'auth_login_total',
    help: 'POST /auth/login 调用次数',
    labelNames: ['result'], // 'success' | 'fail'
    registers: [registry],
  }),
  authRefresh: new Counter({
    name: 'auth_refresh_total',
    help: 'POST /auth/refresh 调用次数',
    labelNames: ['result'], // 'success' | 'invalid' | 'unknown' | 'revoked' | 'expired' | 'user_not_found'
    registers: [registry],
  }),
  authLogout: new Counter({
    name: 'auth_logout_total',
    help: 'logout 调用次数',
    labelNames: ['scope'], // 'self' | 'admin'
    registers: [registry],
  }),
  ssoCallback: new Counter({
    name: 'sso_callback_total',
    help: 'SSO callback 处理次数',
    labelNames: ['provider', 'result'], // provider: github/google/microsoft/feishu/dingtalk; result: 'success' | 'state_mismatch' | 'upstream_failed' | 'not_found' | 'expired'
    registers: [registry],
  }),
  rateLimitHit: new Counter({
    name: 'rate_limit_hits_total',
    help: 'rate limit 命中次数',
    labelNames: ['tier'], // 'free' | 'pro' | 'enterprise' | 'unauth'
    registers: [registry],
  }),
  apiKeyCreate: new Counter({
    name: 'api_key_create_total',
    help: 'API key 创建次数',
    registers: [registry],
  }),
  apiKeyVerify: new Counter({
    name: 'api_key_verify_total',
    help: 'API key verify 调用次数',
    labelNames: ['result'], // 'success' | 'invalid' | 'invalid_format'
    registers: [registry],
  }),
  tierSet: new Counter({
    name: 'tier_set_total',
    help: 'billing_tier 修改次数',
    labelNames: ['tier'], // 'free' | 'pro' | 'enterprise'
    registers: [registry],
  }),
  stripeWebhook: new Counter({
    name: 'stripe_webhook_total',
    help: 'Stripe webhook 处理次数',
    labelNames: ['type', 'result'], // type: subscription.created/updated/deleted/checkout.session.completed; result: 'ok' | 'signature_invalid' | 'parse_error'
    registers: [registry],
  }),

  // 通用 histogram: 所有 HTTP 请求耗时
  httpRequestDuration: new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP 请求耗时 (s)',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  }),
}
