// packages/backend/src/api/stripe.ts · v0.3 spec §13.2 (Stripe webhook)
//
// Phase 7.5: 真实 Stripe webhook 端点
//   验签: HMAC-SHA256(`${timestamp}.${rawBody}`, secret) == v1
//   Mock 模式 (DASHENG_STRIPE_MOCK_MODE=true): 跳过验签, dev 测用
//   路由: POST /api/v1/billing/stripe/webhook (public, 不走 rate limit)
//   事件: subscription.created/updated → set tier, subscription.deleted → free

import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { sqlite } from '../storage/db.js'
import { config } from '../config.js'
import { metrics } from '../core/metrics.js'

// Stripe event type (只列我们关心的几个, 其余走 default log)
interface StripeSubscription {
  id: string
  customer: string
  status: string
  metadata: { user_id?: string }
  items: { data: Array<{ price: { id: string } }> }
}
interface StripeEvent {
  type: string
  data: { object: any }
  id?: string
}

function priceIdToTier(priceId: string): 'free' | 'pro' | 'enterprise' {
  if (priceId === config.DASHENG_STRIPE_PRICE_PRO) return 'pro'
  if (priceId === config.DASHENG_STRIPE_PRICE_ENTERPRISE) return 'enterprise'
  return 'free'
}

function verifyStripeSignature(rawBody: string, sigHeader: string, secret: string): boolean {
  if (!sigHeader || !secret) return false
  // sig header 形如 "t=1234567890,v1=abcdef1234567890..."
  const parts: Record<string, string> = {}
  for (const seg of sigHeader.split(',')) {
    const [k, v] = seg.split('=')
    if (k && v) parts[k] = v
  }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false

  // 1. replay protection: timestamp 不能超过 5 min 旧
  const ageSec = Math.abs(Date.now() / 1000 - Number(t))
  if (!Number.isFinite(ageSec) || ageSec > 300) return false

  // 2. HMAC-SHA256(`${t}.${rawBody}`, secret)
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')

  // 3. timingSafeEqual 防 timing attack
  if (expected.length !== v1.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
  } catch {
    return false
  }
}

export async function stripeRoutes(app: FastifyInstance) {
  // 关掉 rate limit: Stripe 端 4xx/5xx 会重试, rate-limit 429 它引发风暴
  app.post(
    '/billing/stripe/webhook',
    { config: { rateLimit: false } },
    async (req, reply) => {
      const raw = (req as unknown as { rawBody?: string }).rawBody
      if (!raw) {
        metrics.stripeWebhook.inc({ type: 'unknown', result: 'parse_error' })
        return reply.code(400).send({ code: 'RAW_BODY_MISSING' })
      }

      // 1. 验签 (mock 模式跳过)
      if (!config.DASHENG_STRIPE_MOCK_MODE) {
        const sig = req.headers['stripe-signature'] as string
        if (!verifyStripeSignature(raw, sig, config.DASHENG_STRIPE_WEBHOOK_SECRET)) {
          metrics.stripeWebhook.inc({ type: 'unknown', result: 'signature_invalid' })
          return reply.code(400).send({ code: 'SIGNATURE_INVALID' })
        }
      }

      // 2. 解析 + 分发
      let event: StripeEvent
      try {
        event = JSON.parse(raw) as StripeEvent
      } catch {
        metrics.stripeWebhook.inc({ type: 'unknown', result: 'parse_error' })
        return reply.code(400).send({ code: 'INVALID_JSON' })
      }

      try {
        switch (event.type) {
          case 'customer.subscription.created':
          case 'customer.subscription.updated': {
            const sub = event.data.object as StripeSubscription
            const userId = sub.metadata?.user_id
            if (!userId) {
              metrics.stripeWebhook.inc({ type: event.type, result: 'ok' }) // 没 user_id 也算 ok (Stripe 测试事件)
              return reply.send({ received: true, note: 'no user_id in metadata' })
            }
            const tier = priceIdToTier(sub.items?.data?.[0]?.price?.id ?? '')
            const now = Date.now()
            sqlite
              .prepare(
                'INSERT INTO billing_tier (user_id, tier, updated_at) VALUES (?, ?, ?) ' +
                  'ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at',
              )
              .run(userId, tier, now)
            metrics.stripeWebhook.inc({ type: event.type, result: 'ok' })
            metrics.tierSet.inc({ tier })
            app.log.info({ userId, tier, subId: sub.id }, 'stripe subscription updated')
            break
          }
          case 'customer.subscription.deleted': {
            const sub = event.data.object as StripeSubscription
            const userId = sub.metadata?.user_id
            if (userId) {
              sqlite
                .prepare(
                  'INSERT INTO billing_tier (user_id, tier, updated_at) VALUES (?, ?, ?) ' +
                    'ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at',
                )
                .run(userId, 'free', Date.now())
              metrics.tierSet.inc({ tier: 'free' })
            }
            metrics.stripeWebhook.inc({ type: event.type, result: 'ok' })
            app.log.info({ userId, subId: sub.id }, 'stripe subscription deleted')
            break
          }
          case 'checkout.session.completed': {
            // 一次性买断 — Phase 7.5 只 log, Phase 8.5 接真买断流
            metrics.stripeWebhook.inc({ type: event.type, result: 'ok' })
            app.log.info({ session: event.data.object }, 'stripe checkout.session.completed')
            break
          }
          default:
            metrics.stripeWebhook.inc({ type: event.type, result: 'ok' })
            app.log.info({ type: event.type }, 'stripe event unhandled')
        }
      } catch (e) {
        metrics.stripeWebhook.inc({ type: event.type, result: 'parse_error' })
        app.log.error({ err: e, event: event.type }, 'stripe event handler error')
        // 返 500 让 Stripe 重试
        return reply.code(500).send({ code: 'HANDLER_ERROR' })
      }

      return reply.send({ received: true })
    },
  )
}
