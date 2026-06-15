// packages/backend/src/config.ts · v0.3 spec 附录 A (.env 完整表)
// 强约束: 127.0.0.1 绑定 · JWT 必填 · API key 走 Keychain (Phase 2 stub)

import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Backend
  BACKEND_PORT: z.coerce.number().default(8000),
  BACKEND_HOST: z.string().default('127.0.0.1'),

  // Database
  DATABASE_URL: z.string().default('file:./data/dasheng.db'),
  DASHENG_DB_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
  REDIS_NAMESPACE: z.string().default('default'),

  // JWT
  DASHENG_JWT_SECRET: z.string().min(32).default('dev-only-secret-please-replace-in-prod-32chars'),
  DASHENG_JWT_ACCESS_TTL_SEC: z.coerce.number().default(900), // 15 min
  DASHENG_JWT_REFRESH_TTL_SEC: z.coerce.number().default(604800), // 7 d

  // LLM (mock in Phase 1; real in Phase 2)
  OLLAMA_HOST: z.string().default('http://127.0.0.1:11434'),
  DEFAULT_MODEL: z.string().default('ollama:qwen2.5:7b'),

  // DeerFlow
  DEERFLOW_ENABLED: z.coerce.boolean().default(false),
  DEERFLOW_SOCKET_PATH: z.string().default('/tmp/dasheng/deerflow.sock'),

  // Rate Limit
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),

  // Security
  DASHENG_STRICT_SECURITY: z.coerce.boolean().default(false),
  DASHENG_INJECTION_SCAN_ENABLED: z.coerce.boolean().default(true),

  // Audit
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().default(365),
  AUDIT_LOG_HMAC_SECRET: z.string().min(32).default('dev-only-audit-hmac-secret-32chars-min-aaaaa'),

  // Observability
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  METRICS_ENABLED: z.coerce.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(9090),

  // Phase 7.5: Stripe webhook
  //   MOCK_MODE=true → 跳过签名验证 (dev 模式, 老板能 curl 直接发事件测)
  //   MOCK_MODE=false → 必须配 WEBHOOK_SECRET, 验签失败 400
  DASHENG_STRIPE_WEBHOOK_SECRET: z.string().default(''),
  // ⚠️ 不要用 z.coerce.boolean() — JS 的 Boolean('false') === true
  // 用 enum + transform 显式映射
  DASHENG_STRIPE_MOCK_MODE: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),
  DASHENG_STRIPE_PRICE_PRO: z.string().default('price_pro_dev'),
  DASHENG_STRIPE_PRICE_ENTERPRISE: z.string().default('price_enterprise_dev'),

  // Track B · 5 worker 端点 (2026-06-15, 旧 DaShengOS worker 跑在宿主机)
  //   dev: localhost (worker 跑在 macOS)
  //   docker: host.docker.internal (worker 也在宿主机, 通过 host.docker.internal)
  SAU_BRIDGE_URL: z.string().url().default('http://127.0.0.1:9109'),
  DOUYIN_BRIDGE_URL: z.string().url().default('http://127.0.0.1:9112'),
  WECHAT_MP_URL: z.string().url().default('http://127.0.0.1:9113'),
  VIDEO_PARSER_URL: z.string().url().default('http://127.0.0.1:9111'),
  PIXELLE_BRIDGE_URL: z.string().url().default('http://127.0.0.1:9108'),
})

export const config = ConfigSchema.parse(process.env)
export type Config = z.infer<typeof ConfigSchema>
