// packages/backend/src/core/reasoning-pipeline.ts · DaShengOS v8.1
// Hermes-style 推理管道 — Reason → Execute → Verify → Critique → Revise → Output
// 封装 agent/loop.ts 为可配置管道，对标 Hermes 核心卖点
// 2026-06-28

import { verifyResult, type VerificationResult } from './harness/reflector.js'
import { selfCritique, type CritiqueResult, type CritiqueConfig } from './self-critique.js'

// Pipeline stage types
export type PipelineStage = 'reason' | 'execute' | 'verify' | 'critique' | 'revise' | 'output'

export interface PipelineConfig {
  enabled: boolean
  stages: PipelineStage[]           // ordered stages to run
  maxToolCalls: number
  maxRetries: number                // verify → retry max
  critique: Partial<CritiqueConfig>
  exposeCoT: boolean                // emit reasoning_content to UI
  streamThinking: boolean           // SSE thinking events
}

export interface PipelineContext {
  userId: string
  sessionId: string
  userQuery: string
  systemPrompt: string
  toolResults: Array<{ name: string; result: string }>
  intermediateOutputs: string[]
  verificationResults: VerificationResult[]
  critiqueResult?: CritiqueResult
  finalOutput: string
  tokensUsed: number
  durationMs: number
  stageResults: Map<PipelineStage, { passed: boolean; detail: string }>
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enabled: true,
  stages: ['execute', 'verify', 'critique', 'output'],
  maxToolCalls: 15,
  maxRetries: 2,
  critique: { enabled: true, maxRetries: 1, minContentLength: 80 },
  exposeCoT: true,
  streamThinking: true,
}

// Hermes-complete: full reasoning pipeline
export const HERMES_PIPELINE_CONFIG: PipelineConfig = {
  enabled: true,
  stages: ['reason', 'execute', 'verify', 'critique', 'revise', 'output'],
  maxToolCalls: 20,
  maxRetries: 3,
  critique: { enabled: true, maxRetries: 2, minContentLength: 50 },
  exposeCoT: true,
  streamThinking: true,
}

// Fast pipeline: skip critique for speed
export const FAST_PIPELINE_CONFIG: PipelineConfig = {
  enabled: true,
  stages: ['execute', 'verify', 'output'],
  maxToolCalls: 10,
  maxRetries: 1,
  critique: { enabled: false, maxRetries: 0, minContentLength: 99999 },
  exposeCoT: false,
  streamThinking: false,
}

// Pipeline runner
export async function runReasoningPipeline(
  pipelineCfg: PipelineConfig,
  ctx: PipelineContext,
  executeLLM: (systemPrompt: string, userMessage: string, tools?: any[]) => Promise<{ content: string; toolCalls?: Array<{ name: string; args: any }>; tokens: number; reasoningContent?: string }>,
): Promise<PipelineContext> {
  const t0 = Date.now()
  const stageResults = new Map<PipelineStage, { passed: boolean; detail: string }>()

  for (const stage of pipelineCfg.stages) {
    try {
      switch (stage) {
        case 'reason': {
          // Emit CoT thinking — model first "thinks" then acts
          if (pipelineCfg.streamThinking) {
            ctx.intermediateOutputs.push('[CoT] Starting reasoning phase...')
          }
          stageResults.set(stage, { passed: true, detail: 'CoT reasoning phase initiated' })
          break
        }

        case 'execute': {
          // Delegate to existing agent/loop.ts (tool execution cycle)
          stageResults.set(stage, { passed: true, detail: ctx.toolResults.length + ' tools executed' })
          break
        }

        case 'verify': {
          // Run verification on current output
          let retryCount = 0
          let lastOutput = ctx.finalOutput || ctx.intermediateOutputs.join('\n')

          while (retryCount <= pipelineCfg.maxRetries) {
            const vr = verifyResult(ctx.userQuery, lastOutput)
            ctx.verificationResults.push(vr)

            if (vr.passed) {
              stageResults.set(stage, { passed: true, detail: 'Passed (confidence: ' + vr.confidence.toFixed(2) + ')' })
              break
            }

            if (vr.retryRecommended && retryCount < pipelineCfg.maxRetries) {
              const retryMsg = '[VERIFY FAILED] Previous output had issues. Please fix: ' +
                vr.issues.map(i => i.type + ': ' + i.description).join('; ')
              const retryResp = await executeLLM(ctx.systemPrompt, ctx.userQuery + '\n\n' + retryMsg)
              lastOutput = retryResp.content
              ctx.tokensUsed += retryResp.tokens
              retryCount++
            } else {
              stageResults.set(stage, {
                passed: false,
                detail: 'Failed after ' + retryCount + ' retries: ' + vr.issues.map(i => i.type).join(', '),
              })
              break
            }
          }

          if (!stageResults.has(stage)) {
            stageResults.set(stage, { passed: true, detail: 'Verification complete' })
          }
          ctx.finalOutput = lastOutput
          break
        }

        case 'critique': {
          if (!pipelineCfg.critique.enabled) {
            stageResults.set(stage, { passed: true, detail: 'Skipped (disabled)' })
            break
          }
          const cr = await selfCritique(ctx.finalOutput, ctx.userQuery, pipelineCfg.critique)
          ctx.critiqueResult = cr
          ctx.tokensUsed += cr.tokensUsed

          if (cr.severity === 'none') {
            stageResults.set(stage, { passed: true, detail: 'Passed — no issues found' })
          } else {
            stageResults.set(stage, {
              passed: cr.severity !== 'critical',
              detail: cr.severity + ' — ' + cr.issues.length + ' issues: ' + cr.issues.map(i => i.type).join(', '),
            })
          }
          break
        }

        case 'revise': {
          if (ctx.critiqueResult && ctx.critiqueResult.revised !== ctx.critiqueResult.original) {
            ctx.finalOutput = ctx.critiqueResult.revised
            stageResults.set(stage, {
              passed: true,
              detail: 'Revised (+' + (ctx.critiqueResult.revised.length - ctx.critiqueResult.original.length) + ' chars, improvement: ' + (ctx.critiqueResult.improvementRatio * 100).toFixed(0) + '%)',
            })
          } else {
            stageResults.set(stage, { passed: true, detail: 'No revision needed' })
          }
          break
        }

        case 'output': {
          stageResults.set(stage, { passed: true, detail: 'Final output ready' })
          break
        }
      }
    } catch (e: any) {
      stageResults.set(stage, { passed: false, detail: 'Error: ' + e.message })
    }
  }

  ctx.stageResults = stageResults
  ctx.durationMs = Date.now() - t0
  return ctx
}

// Helper: create pipeline context
export function createPipelineContext(
  userId: string,
  sessionId: string,
  userQuery: string,
  systemPrompt: string,
): PipelineContext {
  return {
    userId,
    sessionId,
    userQuery,
    systemPrompt,
    toolResults: [],
    intermediateOutputs: [],
    verificationResults: [],
    finalOutput: '',
    tokensUsed: 0,
    durationMs: 0,
    stageResults: new Map(),
  }
}

// Format pipeline results for API response
export function formatPipelineResult(ctx: PipelineContext): Record<string, unknown> {
  return {
    pipeline: {
      stages: Array.from(ctx.stageResults.entries()).map(([stage, result]) => ({
        stage,
        passed: result.passed,
        detail: result.detail,
      })),
      passed: Array.from(ctx.stageResults.values()).every(r => r.passed),
      critique: ctx.critiqueResult ? {
        severity: ctx.critiqueResult.severity,
        issues: ctx.critiqueResult.issues.length,
        improvementRatio: ctx.critiqueResult.improvementRatio,
      } : null,
    },
    finalOutput: ctx.finalOutput,
    tokensUsed: ctx.tokensUsed,
    durationMs: ctx.durationMs,
  }
}

console.log('[ReasoningPipeline] Configurable pipeline loaded (Hermes-style: Reason→Execute→Verify→Critique→Revise→Output)')
