// packages/backend/src/core/otel-tracer.ts · DaShengOS v6.0
// OpenTelemetry 分布式追踪 — W3C Trace Context + Span 生命周期
// 2026-06-23 · Zero-dependency 实现 (无需 @opentelemetry/api)
//
// 架构:
//   Trace → Span 树 (每个 LLM 调用 / 工具调用 = 1 Span)
//   传播: W3C traceparent header (跨服务传播)
//   导出: JSON 行格式 → logs/otel-traces.jsonl

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════
// Types (OpenTelemetry 兼容)
// ═══════════════════════════════════════════════════════════

export type SpanKind = 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER'
export type SpanStatus = 'OK' | 'ERROR'

export interface SpanAttributes {
  [key: string]: string | number | boolean | string[] | undefined
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: SpanAttributes
}

export interface OTelSpan {
  traceId: string        // 32 hex chars
  spanId: string         // 16 hex chars
  parentSpanId?: string  // 16 hex chars
  name: string
  kind: SpanKind
  startTime: number
  endTime: number
  status: SpanStatus
  attributes: SpanAttributes
  events: SpanEvent[]
  children?: OTelSpan[]
}

export interface TraceContext {
  traceId: string
  spanId: string
  traceFlags: '01'  // sampled
}

// ═══════════════════════════════════════════════════════════
// ID Generator
// ═══════════════════════════════════════════════════════════

function genTraceId(): string {
  return randomBytes(16).toString('hex')  // 32 hex chars
}

function genSpanId(): string {
  return randomBytes(8).toString('hex')   // 16 hex chars
}

// ═══════════════════════════════════════════════════════════
// W3C Trace Context 解析/生成
// ═══════════════════════════════════════════════════════════

export function parseTraceParent(header: string): TraceContext | null {
  // Format: 00-{traceId}-{spanId}-{traceFlags}
  const parts = header.split('-')
  if (parts.length !== 4 || parts[0] !== '00') return null
  if (parts[1].length !== 32 || parts[2].length !== 16) return null
  return { traceId: parts[1], spanId: parts[2], traceFlags: parts[3] as '01' }
}

export function formatTraceParent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`
}

// ═══════════════════════════════════════════════════════════
// Span Builder (Fluent API)
// ═══════════════════════════════════════════════════════════

class SpanBuilder {
  private span: OTelSpan
  private parent?: SpanBuilder

  constructor(name: string, kind: SpanKind, traceId?: string, parentSpanId?: string) {
    this.span = {
      traceId: traceId || genTraceId(),
      spanId: genSpanId(),
      parentSpanId,
      name,
      kind,
      startTime: Date.now(),
      endTime: 0,
      status: 'OK',
      attributes: {},
      events: [],
    }
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.span.attributes[key] = value
    return this
  }

  setAttributes(attrs: SpanAttributes): this {
    Object.assign(this.span.attributes, attrs)
    return this
  }

  addEvent(name: string, attrs?: SpanAttributes): this {
    this.span.events.push({ name, timestamp: Date.now(), attributes: attrs })
    return this
  }

  setStatus(status: SpanStatus): this {
    this.span.status = status
    return this
  }

  child(name: string, kind: SpanKind = 'INTERNAL'): SpanBuilder {
    const child = new SpanBuilder(name, kind, this.span.traceId, this.span.spanId)
    child.parent = this
    return child
  }

  end(): OTelSpan {
    this.span.endTime = Date.now()
    // Add to parent's children if exists
    if (this.parent) {
      if (!this.parent.span.children) this.parent.span.children = []
      this.parent.span.children!.push(this.span)
    }
    return this.span
  }

  getTraceContext(): TraceContext {
    return { traceId: this.span.traceId, spanId: this.span.spanId, traceFlags: '01' }
  }

  getSpan(): OTelSpan { return this.span }
}

// ═══════════════════════════════════════════════════════════
// Active Span 管理 (AsyncLocalStorage 替代)
// ═══════════════════════════════════════════════════════════

const activeSpans = new Map<string, SpanBuilder>()

export function startTrace(name: string, kind: SpanKind = 'SERVER'): SpanBuilder {
  const span = new SpanBuilder(name, kind)
  activeSpans.set(span.getSpan().spanId, span)
  return span
}

export function getActiveSpan(spanId: string): SpanBuilder | undefined {
  return activeSpans.get(spanId)
}

export function endTrace(span: SpanBuilder): OTelSpan {
  activeSpans.delete(span.getSpan().spanId)
  return span.end()
}

// ═══════════════════════════════════════════════════════════
// JSON Lines 导出器
// ═══════════════════════════════════════════════════════════

const LOG_DIR = '/Users/apple/Desktop/ai-workbench-v2/logs'
const OTEL_LOG = LOG_DIR + '/otel-traces.jsonl'

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

export function exportSpan(span: OTelSpan): void {
  ensureLogDir()
  try {
    appendFileSync(OTEL_LOG, JSON.stringify({
      ...span,
      durationMs: span.endTime - span.startTime,
      childCount: span.children?.length || 0,
    }) + '\n')
  } catch { /* non-critical */ }
}

/**
 * 递归导出完整 trace 树
 */
export function exportTrace(rootSpan: OTelSpan): void {
  const flatten = (s: OTelSpan): OTelSpan[] => [s, ...(s.children || []).flatMap(flatten)]
  for (const span of flatten(rootSpan)) exportSpan(span)
}

// ═══════════════════════════════════════════════════════════
// 高级 API: 一键追踪
// ═══════════════════════════════════════════════════════════

export interface TraceResult<T> {
  result: T
  span: OTelSpan
  durationMs: number
}

export async function trace<T>(
  name: string,
  kind: SpanKind,
  attrs: SpanAttributes,
  fn: (span: SpanBuilder) => Promise<T>
): Promise<TraceResult<T>> {
  const span = startTrace(name, kind)
  span.setAttributes(attrs)
  const t0 = Date.now()

  try {
    const result = await fn(span)
    span.setStatus('OK')
    const otelSpan = endTrace(span)
    exportTrace(otelSpan)
    return { result, span: otelSpan, durationMs: Date.now() - t0 }
  } catch (err: any) {
    span.setStatus('ERROR')
    span.addEvent('exception', { message: err.message, stack: err.stack?.slice(0, 500) })
    const otelSpan = endTrace(span)
    exportTrace(otelSpan)
    throw err
  }
}

/**
 * 同步版本
 */
export function traceSync<T>(
  name: string,
  kind: SpanKind,
  attrs: SpanAttributes,
  fn: (span: SpanBuilder) => T
): TraceResult<T> {
  const span = startTrace(name, kind)
  span.setAttributes(attrs)
  const t0 = Date.now()

  try {
    const result = fn(span)
    span.setStatus('OK')
    const otelSpan = endTrace(span)
    exportTrace(otelSpan)
    return { result, span: otelSpan, durationMs: Date.now() - t0 }
  } catch (err: any) {
    span.setStatus('ERROR')
    span.addEvent('exception', { message: err.message })
    const otelSpan = endTrace(span)
    exportTrace(otelSpan)
    throw err
  }
}

// ═══════════════════════════════════════════════════════════
// 查询 API
// ═══════════════════════════════════════════════════════════

export function getRecentTraces(limit = 50): OTelSpan[] {
  ensureLogDir()
  try {
    const { readFileSync } = require('node:fs')
    const lines = readFileSync(OTEL_LOG, 'utf-8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map(l => JSON.parse(l))
  } catch {
    return []
  }
}

export function getTraceStats(hoursBack = 1): {
  totalTraces: number; errorRate: number; avgDurationMs: number
  spanKinds: Record<string, number>
} {
  const cutoff = Date.now() - hoursBack * 3600000
  const traces = getRecentTraces(1000).filter(t => t.startTime > cutoff)

  if (traces.length === 0) return { totalTraces: 0, errorRate: 0, avgDurationMs: 0, spanKinds: {} }

  const errorCount = traces.filter(t => t.status === 'ERROR').length
  const avgDurationMs = Math.round(traces.reduce((s, t) => s + (t.endTime - t.startTime), 0) / traces.length)
  const spanKinds: Record<string, number> = {}
  for (const t of traces) {
    spanKinds[t.kind] = (spanKinds[t.kind] || 0) + 1
  }

  return { totalTraces: traces.length, errorRate: Math.round((errorCount / traces.length) * 100), avgDurationMs, spanKinds }
}

console.log('[OTelTracer] OpenTelemetry 追踪已就绪 → ' + OTEL_LOG)
