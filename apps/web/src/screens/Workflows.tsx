// apps/web/src/screens/Workflows.tsx · Phase B.2
// 多 Agent 编排引擎前端 — 工作流管理页面
// 模板选择 → 任务输入 → 执行进度 → 结果展示

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { http } from '@/lib/api'
import {
  Play, Loader2, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, SkipForward, GitBranch,
  Image, Calendar, Radar, MessageSquare, Globe, BarChart3,
  ArrowRight, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- 类型 ----

interface Template {
  id: string
  name: string
  description: string
  icon: string
  category: string
  estimated_tokens: number
  step_count: number
}

interface StepDetail {
  step_id: string
  agent_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output_preview?: string
  tokens_used?: number
  duration_ms: number
  error?: string
}

interface WorkflowResult {
  workflow_id: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  steps: StepDetail[]
  final_output?: string
  total_duration_ms: number
  total_tokens: number
}

const ICON_MAP: Record<string, typeof Image> = {
  image: Image,
  calendar: Calendar,
  radar: Radar,
  'message-square': MessageSquare,
  globe: Globe,
  'bar-chart-3': BarChart3,
}

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: SkipForward,
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-neutral-500',
  running: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  skipped: 'text-neutral-600',
}

const CATEGORY_LABELS: Record<string, string> = {
  production: '生产',
  content: '内容',
  intelligence: '情报',
  operation: '运营',
  deployment: '部署',
  analytics: '数据',
}

// ---- 组件 ----

export function Workflows() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  // 加载模板列表
  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    setLoadingTemplates(true)
    try {
      const res = await http.get<{ success: boolean; data: Template[] }>(
        '/api/v1/orchestrator/templates',
      )
      setTemplates(res.data)
      if (res.data.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(res.data[0].id)
      }
    } catch (e) {
      console.error('加载模板失败:', e)
    } finally {
      setLoadingTemplates(false)
    }
  }

  // 执行工作流
  const handleExecute = useCallback(async () => {
    if (!input.trim() || !selectedTemplateId) return

    setExecuting(true)
    setError(null)
    setResult(null)

    try {
      const res = await http.post<{
        success: boolean
        data: WorkflowResult
      }>('/api/v1/orchestrator/execute', {
        template_id: selectedTemplateId,
        input: input.trim(),
        workflow: [],
      })

      setResult(res.data)
    } catch (e) {
      setError((e as Error).message || '执行失败')
    } finally {
      setExecuting(false)
    }
  }, [input, selectedTemplateId])

  function toggleStep(stepId: string) {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  return (
    <div className="h-full overflow-auto bg-neutral-950" data-testid="workflows-page">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        {/* 标题 */}
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2">
            <GitBranch className="text-brand" />
            工作流编排
          </h1>
          <p className="text-neutral-400 mt-1 text-sm">
            选择预置工作流模板，输入任务描述，自动执行多步骤任务
          </p>
        </div>

        {/* 模板选择 */}
        <section>
          <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-3">
            选择工作流模板
          </h2>
          {loadingTemplates ? (
            <div className="flex items-center gap-2 text-neutral-500 text-sm py-4">
              <Loader2 size={14} className="animate-spin" />
              加载模板中...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map(template => {
                const Icon = ICON_MAP[template.icon] || GitBranch
                const isSelected = selectedTemplateId === template.id
                return (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={cn(
                      'text-left p-4 rounded-lg border transition-all duration-150',
                      isSelected
                        ? 'border-brand bg-brand/5 ring-1 ring-brand/30'
                        : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700 hover:bg-neutral-900',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Icon size={20} className={cn(
                        'mt-0.5 flex-shrink-0',
                        isSelected ? 'text-brand' : 'text-neutral-500',
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-neutral-200">
                          {template.name}
                        </div>
                        <div className="text-xs text-neutral-400 mt-1 line-clamp-2">
                          {template.description}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded">
                            {CATEGORY_LABELS[template.category] || template.category}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            {template.step_count} 步骤
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            ~{template.estimated_tokens.toLocaleString()} tokens
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* 任务输入 */}
        <section>
          <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-3">
            任务描述
          </h2>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={
              selectedTemplate
                ? `为「${selectedTemplate.name}」工作流输入任务描述...`
                : '请先选择工作流模板...'
            }
            rows={4}
            className={cn(
              'w-full px-4 py-3 rounded-lg border bg-neutral-900 text-neutral-200',
              'text-sm resize-none placeholder:text-neutral-600',
              'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
              'border-neutral-800',
            )}
            disabled={executing}
          />
          <div className="flex items-center justify-between mt-3">
            <div className="text-xs text-neutral-500">
              {selectedTemplate?.estimated_tokens && (
                <span>预估消耗 ~{selectedTemplate.estimated_tokens.toLocaleString()} tokens</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {executing && (
                <span className="text-xs text-blue-400 flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  执行中...
                </span>
              )}
              <Button
                onClick={handleExecute}
                disabled={!input.trim() || !selectedTemplateId || executing}
                leftIcon={executing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              >
                {executing ? '执行中...' : '执行工作流'}
              </Button>
            </div>
          </div>
        </section>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2 p-4 rounded-lg border border-red-500/30 bg-red-500/5">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm text-red-400 font-medium">执行失败</div>
              <div className="text-xs text-red-400/70 mt-1">{error}</div>
            </div>
          </div>
        )}

        {/* 执行结果 */}
        {result && (
          <section>
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-3">
              执行结果
            </h2>

            {/* 总体状态 */}
            <div className={cn(
              'p-4 rounded-lg border mb-4',
              result.status === 'completed' && 'border-green-500/30 bg-green-500/5',
              result.status === 'partial' && 'border-yellow-500/30 bg-yellow-500/5',
              result.status === 'failed' && 'border-red-500/30 bg-red-500/5',
              result.status === 'running' && 'border-blue-500/30 bg-blue-500/5',
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result.status === 'completed' && <CheckCircle2 size={18} className="text-green-400" />}
                  {result.status === 'partial' && <AlertCircle size={18} className="text-yellow-400" />}
                  {result.status === 'failed' && <XCircle size={18} className="text-red-400" />}
                  <span className={cn('text-sm font-medium', STATUS_COLORS[result.status] || 'text-neutral-300')}>
                    {result.status === 'completed' ? '执行完成' :
                     result.status === 'partial' ? '部分完成' :
                     result.status === 'failed' ? '执行失败' : '执行中'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span>{formatDuration(result.total_duration_ms)}</span>
                  <span>{result.total_tokens.toLocaleString()} tokens</span>
                  <span>{result.steps.length} 步骤</span>
                </div>
              </div>
            </div>

            {/* 步骤详情 */}
            <div className="space-y-2">
              {result.steps.map((step, idx) => {
                const StatusIcon = STATUS_ICONS[step.status] || Clock
                const isExpanded = expandedSteps.has(step.step_id)

                return (
                  <div
                    key={step.step_id}
                    className="border border-neutral-800 rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => toggleStep(step.step_id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-900/50 transition-colors"
                    >
                      <span className="text-xs text-neutral-600 font-mono w-6">
                        {idx + 1}
                      </span>
                      <ArrowRight size={12} className="text-neutral-600" />
                      <StatusIcon
                        size={14}
                        className={cn(
                          STATUS_COLORS[step.status],
                          step.status === 'running' && 'animate-spin',
                        )}
                      />
                      <span className="text-sm text-neutral-300 font-medium flex-1">
                        {step.agent_id}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {formatDuration(step.duration_ms)}
                      </span>
                      {step.tokens_used != null && (
                        <span className="text-xs text-neutral-600">
                          {step.tokens_used} tok
                        </span>
                      )}
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-3 border-t border-neutral-800">
                        {step.error && (
                          <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                            {step.error}
                          </div>
                        )}
                        {step.output_preview && (
                          <div className="mt-3">
                            <div className="text-[10px] text-neutral-500 uppercase mb-1">输出预览</div>
                            <pre className="text-xs text-neutral-400 whitespace-pre-wrap font-mono bg-neutral-900 p-3 rounded max-h-60 overflow-auto">
                              {step.output_preview}
                              {step.output_preview.length >= 200 && '...'}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 最终输出 */}
            {result.final_output && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-neutral-300 mb-3">
                  最终输出
                </h3>
                <div className="p-4 rounded-lg border border-neutral-800 bg-neutral-900">
                  <pre className="text-sm text-neutral-300 whitespace-pre-wrap font-sans leading-relaxed">
                    {result.final_output}
                  </pre>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
