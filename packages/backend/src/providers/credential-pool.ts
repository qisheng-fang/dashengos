// packages/backend/src/providers/credential-pool.ts · D3.3 (2026-06-17)
// 仿 Hermes credential_pool: 同一 provider 多 key 轮换 + 失败自动跳过

export type Strategy = 'fill_first' | 'round_robin' | 'random'

export class CredentialPool {
  private keys: string[] = []
  private strategy: Strategy
  private idx = 0
  private failed: Map<string, number> = new Map()
  private readonly FAIL_COOLDOWN_MS = 60_000

  constructor(envVar: string, strategy: Strategy = 'round_robin') {
    this.strategy = strategy
    const all = process.env[envVar] || ''
    // 支持 KEY1,KEY2,KEY3 或 单个 KEY
    if (all.includes(',')) {
      this.keys = all.split(',').map(k => k.trim()).filter(Boolean)
    } else if (all) {
      this.keys = [all]
    }
  }

  /** 取一个 key (按 strategy) */
  pick(): string | null {
    if (this.keys.length === 0) return null
    if (this.strategy === 'fill_first') {
      return this.keys[0]
    }
    if (this.strategy === 'random') {
      const available = this.keys.filter(k => !this.isInCooldown(k))
      if (available.length === 0) return this.keys[Math.floor(Math.random() * this.keys.length)]
      return available[Math.floor(Math.random() * available.length)]
    }
    // round_robin + 跳过 cooldown
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.idx + i) % this.keys.length]
      if (!this.isInCooldown(k)) {
        this.idx = (this.idx + i + 1) % this.keys.length
        return k
      }
    }
    return this.keys[0]
  }

  /** 标记 key 失败 (60s 内不再用) */
  markFailed(key: string) {
    this.failed.set(key, Date.now())
  }

  /** 标记 key 成功 (清除失败记录) */
  markOk(key: string) {
    this.failed.delete(key)
  }

  private isInCooldown(key: string): boolean {
    const ts = this.failed.get(key)
    if (!ts) return false
    if (Date.now() - ts > this.FAIL_COOLDOWN_MS) {
      this.failed.delete(key)
      return false
    }
    return true
  }

  /** 当前池状态 (调试用) */
  status() {
    return {
      strategy: this.strategy,
      total: this.keys.length,
      active: this.keys.filter(k => !this.isInCooldown(k)).length,
      failed: Array.from(this.failed.entries()).map(([k, ts]) => ({
        key: k.slice(0, 6) + '...',
        cooldown_remaining_sec: Math.max(0, Math.ceil((this.FAIL_COOLDOWN_MS - (Date.now() - ts)) / 1000)),
      })),
    }
  }
}
