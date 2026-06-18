// apps/web/src/routes/_workspace.visualizations.tsx · Phase A.5 (2026-06-17)
// 可视化页面 — 图表生成 & SVG 渲染 实时预览
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ChartRenderer } from '@/components/visualization/ChartRenderer'
import { SvgRenderer } from '@/components/visualization/SvgRenderer'
import { http } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BarChart3, Code2, RefreshCw, Palette, FileJson, Image, Zap, Maximize2, CheckCircle2 } from 'lucide-react'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import type { ChartData, ChartType } from 'chart.js'

// ─── 预设示例 ────────────────────────────────────────────

type Preset = {
  id: string
  label: string
  icon: typeof BarChart3
  type: ChartType
  config: string
}

const PRESETS: Preset[] = [
  {
    id: 'revenue',
    label: '季度收入',
    icon: BarChart3,
    type: 'bar',
    config: JSON.stringify({
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      datasets: [
        { label: '收入 (万元)', data: [120, 185, 140, 210] },
        { label: '成本 (万元)', data: [80, 120, 95, 135] },
      ],
    }, null, 2),
  },
  {
    id: 'trend',
    label: '月度趋势',
    icon: Zap,
    type: 'line',
    config: JSON.stringify({
      labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'],
      datasets: [
        { label: '用户增长', data: [100, 125, 160, 210, 280, 350, 410, 490] },
        { label: '活跃度', data: [85, 90, 92, 95, 93, 91, 88, 86] },
      ],
    }, null, 2),
  },
  {
    id: 'pie',
    label: '市场份额',
    icon: Palette,
    type: 'pie',
    config: JSON.stringify({
      labels: ['产品A', '产品B', '产品C', '产品D', '其他'],
      datasets: [{ data: [35, 25, 20, 12, 8] }],
    }, null, 2),
  },
  {
    id: 'radar',
    label: '能力雷达',
    icon: Maximize2,
    type: 'radar',
    config: JSON.stringify({
      labels: ['技术', '产品', '运营', '销售', '财务', '人力'],
      datasets: [
        { label: '当前', data: [85, 72, 68, 55, 60, 70] },
        { label: '目标', data: [90, 85, 80, 75, 80, 85] },
      ],
    }, null, 2),
  },
]

const SVG_PRESETS = [
  {
    id: 'flowchart',
    label: '流程图',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect x="150" y="20" width="100" height="40" rx="6" fill="#2563eb" stroke="#1d4ed8" stroke-width="2"/>
  <text x="200" y="45" text-anchor="middle" fill="white" font-size="14" font-family="sans-serif">开始</text>
  <line x1="200" y1="60" x2="200" y2="90" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="130" y="90" width="140" height="40" rx="6" fill="#22c55e" stroke="#16a34a" stroke-width="2"/>
  <text x="200" y="115" text-anchor="middle" fill="white" font-size="13" font-family="sans-serif">处理数据</text>
  <line x1="200" y1="130" x2="200" y2="160" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
  <polygon points="200,160 240,200 200,240 160,200" fill="#f59e0b" stroke="#d97706" stroke-width="2"/>
  <text x="200" y="204" text-anchor="middle" fill="white" font-size="12" font-family="sans-serif">判断</text>
  <line x1="240" y1="200" x2="290" y2="200" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
  <rect x="290" y="180" width="80" height="40" rx="6" fill="#ef4444" stroke="#dc2626" stroke-width="2"/>
  <text x="330" y="205" text-anchor="middle" fill="white" font-size="13" font-family="sans-serif">结束</text>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 Z" fill="#64748b"/>
    </marker>
  </defs>
</svg>`,
  },
  {
    id: 'arch',
    label: '架构图',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 220">
  <rect x="10" y="10" width="120" height="60" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <text x="70" y="38" text-anchor="middle" fill="#93c5fd" font-size="13" font-family="sans-serif">React 前端</text>
  <text x="70" y="56" text-anchor="middle" fill="#64748b" font-size="10" font-family="sans-serif">Vite + TanStack</text>
  <line x1="130" y1="40" x2="190" y2="40" stroke="#475569" stroke-width="2"/>
  <rect x="190" y="10" width="120" height="60" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <text x="250" y="38" text-anchor="middle" fill="#86efac" font-size="13" font-family="sans-serif">Fastify API</text>
  <text x="250" y="56" text-anchor="middle" fill="#64748b" font-size="10" font-family="sans-serif">TypeScript</text>
  <line x1="310" y1="40" x2="370" y2="40" stroke="#475569" stroke-width="2"/>
  <rect x="370" y="10" width="120" height="60" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <text x="430" y="38" text-anchor="middle" fill="#fde68a" font-size="13" font-family="sans-serif">LLM 引擎</text>
  <text x="430" y="56" text-anchor="middle" fill="#64748b" font-size="10" font-family="sans-serif">SiliconFlow</text>
  <line x1="70" y1="70" x2="70" y2="130" stroke="#475569" stroke-width="2"/>
  <line x1="250" y1="70" x2="250" y2="130" stroke="#475569" stroke-width="2"/>
  <line x1="430" y1="70" x2="430" y2="130" stroke="#475569" stroke-width="2"/>
  <rect x="10" y="130" width="120" height="60" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <text x="70" y="158" text-anchor="middle" fill="#c4b5fd" font-size="13" font-family="sans-serif">SQLite</text>
  <text x="70" y="176" text-anchor="middle" fill="#64748b" font-size="10" font-family="sans-serif">存储</text>
  <rect x="190" y="130" width="120" height="60" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <text x="250" y="158" text-anchor="middle" fill="#fca5a5" font-size="13" font-family="sans-serif">Redis</text>
  <text x="250" y="176" text-anchor="middle" fill="#64748b" font-size="10" font-family="sans-serif">缓存</text>
  <rect x="370" y="130" width="120" height="60" rx="8" fill="#1e293b" stroke="#475569" stroke-width="2"/>
  <text x="430" y="158" text-anchor="middle" fill="#fdba74" font-size="13" font-family="sans-serif">MCP 服务</text>
  <text x="430" y="176" text-anchor="middle" fill="#64748b" font-size="10" font-family="sans-serif">工具集成</text>
</svg>`,
  },
]

// ─── Types ────────────────────────────────────────────────

interface PaletteInfo {
  name: string
  description: string
  categorical: string[]
}

interface PalettesResponse {
  palettes: Record<string, PaletteInfo>
}

// ─── Main Component ──────────────────────────────────────

export function VisualizationsPage() {
  const [activeTab, setActiveTab] = useState<'chart' | 'svg'>('chart')
  const [selectedPreset, setSelectedPreset] = useState<string>('revenue')
  const [jsonInput, setJsonInput] = useState('')
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [parseError, setParseError] = useState<string | null>(null)
  const [palettes, setPalettes] = useState<PaletteInfo[]>([])
  const [paletteLoading, setPaletteLoading] = useState(false)

  // SVG state
  const [svgInput, setSvgInput] = useState('')
  const [selectedSvgPreset, setSelectedSvgPreset] = useState<string>('flowchart')

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // ─── Load palettes on mount ─────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setPaletteLoading(true)
      try {
        const res = await http.get<PalettesResponse>('/api/v1/visualizations/palette')
        if (cancelled) return
        setPalettes(Object.values(res.palettes))
      } catch {
        // 静默忽略
      } finally {
        if (!cancelled) setPaletteLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ─── Initialize preset ──────────────────────────────
  useEffect(() => {
    const preset = PRESETS.find((p) => p.id === selectedPreset)
    if (preset) {
      setJsonInput(preset.config)
      setChartType(preset.type)
      setParseError(null)
    }
  }, [selectedPreset])

  // ─── Initialize SVG preset ──────────────────────────
  useEffect(() => {
    const preset = SVG_PRESETS.find((p) => p.id === selectedSvgPreset)
    if (preset) {
      setSvgInput(preset.svg)
    }
  }, [selectedSvgPreset])

  // ─── Parse JSON input ───────────────────────────────
  const parsedData = useMemo((): ChartData | null => {
    if (!jsonInput.trim()) return null
    try {
      const obj = JSON.parse(jsonInput)
      if (obj && obj.datasets && Array.isArray(obj.datasets) && obj.datasets.length > 0) {
        return obj as ChartData
      }
      return null
    } catch {
      return null
    }
  }, [jsonInput])

  // ─── Auto-validate with debounce ────────────────────
  const handleJsonChange = useCallback((value: string) => {
    setJsonInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        JSON.parse(value)
        setParseError(null)
      } catch (e) {
        setParseError((e as Error).message)
      }
      // Also call backend to validate
      try {
        const obj = JSON.parse(value)
        if (obj?.datasets) {
          http.post('/api/v1/visualizations/chart', {
            type: chartType,
            data: obj,
          }).catch(() => {})
        }
      } catch {
        // parse fail, skip backend
      }
    }, 600)
  }, [chartType])

  // ─── Format JSON ────────────────────────────────────
  const handleFormat = useCallback(() => {
    try {
      const obj = JSON.parse(jsonInput)
      setJsonInput(JSON.stringify(obj, null, 2))
      setParseError(null)
    } catch (e) {
      setParseError((e as Error).message)
    }
  }, [jsonInput])

  // ─── Copy chart config ──────────────────────────────
  const handleCopyConfig = useCallback(() => {
    if (parsedData) {
      const config = {
        type: chartType,
        data: parsedData,
      }
      navigator.clipboard.writeText(JSON.stringify(config, null, 2))
    }
  }, [parsedData, chartType])

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100 flex items-center gap-2">
            <BarChart3 size={22} className="text-brand" />
            可视化
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            图表生成 · SVG 渲染 · 实时预览
          </p>
        </div>
      </div>

      {/* Tab Switch */}
      <div className="flex border-b border-neutral-800">
        {[
          { id: 'chart' as const, label: '图表', icon: BarChart3 },
          { id: 'svg' as const, label: 'SVG', icon: Image },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-brand text-brand'
                : 'border-transparent text-neutral-400 hover:text-neutral-200',
            )}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Chart Tab ──────────────────────────────── */}
      {activeTab === 'chart' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Controls */}
          <div className="space-y-4">
            {/* Presets */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap size={14} className="text-amber-400" />
                  预设
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPreset(p.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md text-xs flex items-center gap-2 transition-colors',
                      selectedPreset === p.id
                        ? 'bg-brand/10 text-brand border border-brand/30'
                        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
                    )}
                  >
                    <p.icon size={13} />
                    {p.label}
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Chart Type Selector */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">图表类型</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {(['bar', 'line', 'pie', 'radar'] as ChartType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setChartType(t)}
                      className={cn(
                        'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                        chartType === t
                          ? 'bg-brand/20 text-brand border border-brand/30'
                          : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border border-transparent',
                      )}
                    >
                      {t === 'bar' ? '柱状图' : t === 'line' ? '折线图' : t === 'pie' ? '饼图' : '雷达图'}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Palettes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Palette size={14} className="text-purple-400" />
                  配色方案
                  {paletteLoading && <RefreshCw size={10} className="animate-spin text-neutral-500" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {palettes.length === 0 ? (
                  <p className="text-xs text-neutral-500">加载配色方案...</p>
                ) : (
                  <div className="space-y-2">
                    {palettes.map((p) => (
                      <div key={p.name} className="space-y-1">
                        <div className="text-xs text-neutral-300 font-medium">{p.name}</div>
                        <div className="flex gap-1">
                          {p.categorical.slice(0, 5).map((color, i) => (
                            <div
                              key={i}
                              className="w-5 h-5 rounded"
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: JSON Editor + Preview */}
          <div className="lg:col-span-2 space-y-4">
            {/* JSON Editor */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileJson size={14} className="text-blue-400" />
                    Chart 数据 (JSON)
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFormat}
                      title="格式化 JSON"
                    >
                      <Code2 size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyConfig}
                      disabled={!parsedData}
                      title="复制配置"
                    >
                      <CheckCircle2 size={13} />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label className="text-xs text-neutral-500">
                    输入 chart.js 数据格式 (labels + datasets)
                  </Label>
                  <textarea
                    value={jsonInput}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    className={cn(
                      'w-full h-48 px-3 py-2 text-sm font-mono bg-neutral-900 border rounded-md resize-y text-neutral-200 placeholder-neutral-600',
                      parseError
                        ? 'border-red-500/50 focus:border-red-500'
                        : 'border-neutral-700 focus:border-brand/50',
                      'focus:outline-none transition-colors',
                    )}
                    placeholder='{"labels": [...], "datasets": [...]}'
                    spellCheck={false}
                  />
                  {parseError && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <span>JSON 解析错误:</span>
                      <span className="font-mono">{parseError}</span>
                    </p>
                  )}
                  {!parseError && parsedData && (
                    <p className="text-xs text-green-500 flex items-center gap-1">
                      ✓ 有效: {parsedData.labels?.length ?? 0} 标签, {parsedData.datasets?.length ?? 0} 数据集
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Live Preview */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  实时预览
                  <span className="text-xs text-neutral-500 font-normal">
                    ({chartType === 'bar' ? '柱状图' : chartType === 'line' ? '折线图' : chartType === 'pie' ? '饼图' : '雷达图'})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {parsedData ? (
                  <ChartRenderer
                    key={`${chartType}-${jsonInput.length}`}
                    type={chartType}
                    data={parsedData}
                    className="min-h-[320px]"
                  />
                ) : (
                  <div className="flex items-center justify-center h-72 text-neutral-500 text-sm">
                    请输入有效的 Chart 数据以预览
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── SVG Tab ─────────────────────────────────── */}
      {activeTab === 'svg' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Controls */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap size={14} className="text-amber-400" />
                  SVG 预设
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {SVG_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedSvgPreset(p.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md text-xs flex items-center gap-2 transition-colors',
                      selectedSvgPreset === p.id
                        ? 'bg-brand/10 text-brand border border-brand/30'
                        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
                    )}
                  >
                    <Image size={13} />
                    {p.label}
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1L14 4V10L8 13L2 10V4L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                  支持的格式
                </CardTitle>
                <CardDescription className="text-xs">
                  流程图 · 架构图 · 关系图 · 时间线 · 组织结构图
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-neutral-500 space-y-1">
                  <p>• 直接粘贴 SVG 代码到编辑器</p>
                  <p>• 自动清洗 script/事件处理器</p>
                  <p>• 支持 viewBox 自适应</p>
                  <p>• 点击全屏查看</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Editor + Preview */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileJson size={14} className="text-green-400" />
                  SVG 源码
                </CardTitle>
              </CardHeader>
              <CardContent>
                <textarea
                  value={svgInput}
                  onChange={(e) => setSvgInput(e.target.value)}
                  className="w-full h-40 px-3 py-2 text-sm font-mono bg-neutral-900 border border-neutral-700 rounded-md resize-y text-neutral-200 placeholder-neutral-600 focus:border-brand/50 focus:outline-none transition-colors"
                  placeholder="<svg>...</svg>"
                  spellCheck={false}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">SVG 预览</CardTitle>
              </CardHeader>
              <CardContent>
                <SvgRenderer
                  svg={svgInput}
                  maxWidth={800}
                  maxHeight={500}
                  title={SVG_PRESETS.find((p) => p.id === selectedSvgPreset)?.label}
                  allowFullscreen
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
