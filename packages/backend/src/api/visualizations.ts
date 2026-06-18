// packages/backend/src/api/visualizations.ts · Phase A.5 (2026-06-17)
// 可视化 API — chart 配置验证 & 调色板
// 前缀: /api/v1/visualizations
//
// 端点:
//   POST /chart   — 验证并规范化 chart.js 配置
//   GET  /palette  — 返回预制配色方案

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// ─── Zod Schemas ─────────────────────────────────────────

const ChartType = z.enum(['bar', 'line', 'pie', 'radar', 'doughnut', 'polarArea', 'scatter', 'bubble'])

const ChartDataSchema = z.object({
  labels: z.array(z.string()).min(1).max(100).optional(),
  datasets: z
    .array(
      z.object({
        label: z.string().max(200).optional(),
        data: z.array(z.union([z.number(), z.null()])).min(1).max(500),
        backgroundColor: z.union([z.string(), z.array(z.string())]).optional(),
        borderColor: z.union([z.string(), z.array(z.string())]).optional(),
        borderWidth: z.number().min(0).max(20).optional(),
        borderRadius: z.number().min(0).max(20).optional(),
        tension: z.number().min(0).max(1).optional(),
        fill: z.boolean().optional(),
        spanGaps: z.boolean().optional(),
        pointRadius: z.number().min(0).max(20).optional(),
        pointHoverRadius: z.number().min(0).max(30).optional(),
        hidden: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(10),
})

const ChartOptionsSchema = z
  .object({
    indexAxis: z.enum(['x', 'y']).optional(),
    plugins: z
      .object({
        title: z
          .object({
            display: z.boolean().optional(),
            text: z.string().max(500).optional(),
            font: z
              .object({
                size: z.number().min(8).max(72).optional(),
              })
              .optional(),
          })
          .optional(),
        legend: z
          .object({
            display: z.boolean().optional(),
            position: z.enum(['top', 'bottom', 'left', 'right']).optional(),
          })
          .optional(),
      })
      .optional(),
    scales: z
      .record(z.string(), z.object({
        beginAtZero: z.boolean().optional(),
        stacked: z.boolean().optional(),
        title: z.object({
          display: z.boolean().optional(),
          text: z.string().max(200).optional(),
        }).optional(),
      }))
      .optional(),
  })
  .optional()

const ChartBody = z.object({
  type: ChartType.default('bar'),
  data: ChartDataSchema,
  options: ChartOptionsSchema,
})

// ─── 配色方案 ────────────────────────────────────────────

const PALETTES = {
  // 中国股市惯例：红涨绿跌
  stock_cn: {
    name: '中国股市 (红涨绿跌)',
    description: '遵循中国股票市场惯例，红色表示上涨/正数，绿色表示下跌/负数',
    up: 'rgba(220, 38, 38, 0.85)',
    down: 'rgba(22, 163, 74, 0.85)',
    upLight: 'rgba(254, 202, 202, 0.5)',
    downLight: 'rgba(187, 247, 208, 0.5)',
    neutral: 'rgba(113, 113, 122, 0.6)',
    categorical: [
      'rgba(220, 38, 38, 0.85)',
      'rgba(22, 163, 74, 0.85)',
      'rgba(37, 99, 235, 0.85)',
      'rgba(202, 138, 4, 0.85)',
      'rgba(147, 51, 234, 0.85)',
      'rgba(8, 145, 178, 0.85)',
      'rgba(225, 29, 72, 0.85)',
      'rgba(101, 163, 13, 0.85)',
    ],
  },
  // 西方惯例：绿涨红跌
  stock_west: {
    name: '西方股市 (绿涨红跌)',
    description: '遵循西方股票市场惯例，绿色表示上涨，红色表示下跌',
    up: 'rgba(22, 163, 74, 0.85)',
    down: 'rgba(220, 38, 38, 0.85)',
    upLight: 'rgba(187, 247, 208, 0.5)',
    downLight: 'rgba(254, 202, 202, 0.5)',
    neutral: 'rgba(113, 113, 122, 0.6)',
    categorical: [
      'rgba(22, 163, 74, 0.85)',
      'rgba(37, 99, 235, 0.85)',
      'rgba(202, 138, 4, 0.85)',
      'rgba(147, 51, 234, 0.85)',
      'rgba(220, 38, 38, 0.85)',
      'rgba(8, 145, 178, 0.85)',
      'rgba(225, 29, 72, 0.85)',
      'rgba(101, 163, 13, 0.85)',
    ],
  },
  // 中性商务配色
  business: {
    name: '商务中性',
    description: 'formal 蓝灰色调，适合企业报告和仪表盘',
    primary: '#2563eb',
    secondary: '#64748b',
    accent: '#f59e0b',
    success: '#22c55e',
    danger: '#ef4444',
    categorical: [
      'rgba(37, 99, 235, 0.8)',
      'rgba(100, 116, 139, 0.8)',
      'rgba(245, 158, 11, 0.8)',
      'rgba(34, 197, 94, 0.8)',
      'rgba(239, 68, 68, 0.8)',
      'rgba(168, 85, 247, 0.8)',
      'rgba(6, 182, 212, 0.8)',
      'rgba(236, 72, 153, 0.8)',
    ],
  },
  // 暗色主题
  dark: {
    name: '暗色主题',
    description: '针对深色背景优化的高对比度配色',
    background: '#171717',
    grid: 'rgba(64, 64, 64, 0.3)',
    text: '#a3a3a3',
    categorical: [
      'rgba(96, 165, 250, 0.9)',
      'rgba(74, 222, 128, 0.9)',
      'rgba(250, 204, 21, 0.9)',
      'rgba(248, 113, 113, 0.9)',
      'rgba(192, 132, 252, 0.9)',
      'rgba(34, 211, 238, 0.9)',
      'rgba(251, 146, 60, 0.9)',
      'rgba(251, 113, 133, 0.9)',
    ],
  },
}

// ─── 工具函数 ────────────────────────────────────────────

function normalizeChartConfig(body: z.infer<typeof ChartBody>) {
  const { type, data, options } = body

  // 1. 自动补全 labels (如果 datasets 有数据但 labels 为空)
  if ((!data.labels || data.labels.length === 0) && data.datasets.length > 0) {
    const maxLen = Math.max(...data.datasets.map((d) => d.data.length))
    data.labels = Array.from({ length: maxLen }, (_, i) => `项目 ${i + 1}`)
  }

  // 2. 截断 labels 与 data 对齐
  if (data.labels) {
    const maxLen = Math.max(...data.datasets.map((d) => d.data.length))
    data.labels = data.labels.slice(0, maxLen)
  }

  // 3. 补默认颜色 (使用中国股市配色)
  for (const ds of data.datasets) {
    if (!ds.backgroundColor) {
      if (type === 'pie' || type === 'doughnut' || type === 'polarArea') {
        ds.backgroundColor = PALETTES.stock_cn.categorical.slice(0, ds.data.length)
      }
    }
    if (!ds.borderColor) {
      if (type === 'pie' || type === 'doughnut') {
        ds.borderColor = '#171717'
      }
    }
    if (ds.borderWidth == null) {
      ds.borderWidth = type === 'bar' ? 0 : 2
    }
    if (ds.tension == null && (type === 'line')) {
      ds.tension = 0.3
    }
  }

  // 4. 饼图强制 beginAtZero = false (无意义)
  if (type === 'pie' || type === 'doughnut' || type === 'radar') {
    if (options?.scales) {
      for (const scale of Object.values(options.scales)) {
        delete scale.beginAtZero
      }
    }
  }

  return { type, data, options }
}

// ─── Route Handler ────────────────────────────────────

export async function visualizationRoutes(app: FastifyInstance) {
  // POST /chart — 验证并规范化 chart.js 配置
  app.post('/chart', async (req, reply) => {
    const parsed = ChartBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid chart configuration',
        details: parsed.error.issues,
      })
    }

    const config = normalizeChartConfig(parsed.data)

    return reply.send({
      code: 'OK',
      config,
      meta: {
        palette: 'stock_cn',
        paletteName: PALETTES.stock_cn.name,
      },
    })
  })

  // GET /palette — 返回所有配色方案
  app.get('/palette', async (_req, reply) => {
    return reply.send({
      code: 'OK',
      palettes: PALETTES,
    })
  })

  // GET /palette/:name — 返回单个配色方案
  app.get<{ Params: { name: string } }>('/palette/:name', async (req, reply) => {
    const palette = PALETTES[req.params.name as keyof typeof PALETTES]
    if (!palette) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: `Palette '${req.params.name}' not found. Available: ${Object.keys(PALETTES).join(', ')}`,
      })
    }
    return reply.send({ code: 'OK', palette })
  })
}
