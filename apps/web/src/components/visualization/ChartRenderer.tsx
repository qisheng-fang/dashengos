// apps/web/src/components/visualization/ChartRenderer.tsx · Phase A.5
// Chart.js 图表渲染组件 — 中文友善默认值 + 红绿配色(中国股市惯例)
import { useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
  type ChartType,
} from 'chart.js'
import { Bar, Line, Pie, Radar } from 'react-chartjs-2'
import { cn } from '@/lib/utils'

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
)

// 中国股市惯例：红涨绿跌（与西方相反）
const RED = 'rgba(220, 38, 38, 0.85)'
const GREEN = 'rgba(22, 163, 74, 0.85)'
const RED_LIGHT = 'rgba(254, 202, 202, 0.5)'
const GREEN_LIGHT = 'rgba(187, 247, 208, 0.5)'

const PIE_COLORS = [
  RED, GREEN, 'rgba(37, 99, 235, 0.85)',
  'rgba(202, 138, 4, 0.85)', 'rgba(147, 51, 234, 0.85)',
  'rgba(8, 145, 178, 0.85)', 'rgba(225, 29, 72, 0.85)',
  'rgba(101, 163, 13, 0.85)',
]

function detectChartType(
  data: ChartData,
  explicit?: ChartType | null,
): ChartType {
  if (explicit) return explicit as ChartType

  const ds = data.datasets?.[0]?.data
  if (!ds || ds.length === 0) return 'bar'

  const labels = data.labels ?? []
  // Pie: 小数据集 + 全部正数 → 饼图
  if (labels.length <= 8 && labels.length >= 2 && ds.every((v) => typeof v === 'number' && v > 0)) {
    return 'pie'
  }
  // Radar: 5-10 个数据点，值在 0-100 范围（评分场景）
  if (labels.length >= 3 && labels.length <= 10 && ds.every((v) => typeof v === 'number' && v >= 0 && v <= 100)) {
    return 'radar'
  }
  // 时间序列 → 折线图
  if (labels.length > 10) return 'line'
  return 'bar'
}

export interface ChartRendererProps {
  type?: ChartType | null
  data: ChartData
  options?: ChartOptions
  className?: string
  /** 覆盖 auto-detect */
  autoDetect?: boolean
}

export function ChartRenderer({
  type,
  data,
  options: userOptions,
  className,
  autoDetect = true,
}: ChartRendererProps) {
  const resolvedType = useMemo(
    () => (autoDetect ? detectChartType(data, type) : (type ?? 'bar')),
    [data, type, autoDetect],
  ) as ChartType

  const mergedOptions = useCallback(
    (defaults: ChartOptions): ChartOptions => ({
      responsive: true,
      maintainAspectRatio: false,
      ...defaults,
      ...userOptions,
      plugins: {
        ...defaults.plugins,
        ...userOptions?.plugins,
        legend: {
          position: 'bottom' as const,
          labels: {
            font: { size: 12, family: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
            color: '#a3a3a3',
            usePointStyle: true,
            padding: 16,
            ...((userOptions?.plugins as Record<string, unknown>)?.legend as Record<string, unknown>),
          },
        },
        tooltip: {
          backgroundColor: 'rgba(23, 23, 23, 0.95)',
          titleFont: { size: 13, family: "'Inter', 'PingFang SC', sans-serif" },
          bodyFont: { size: 12, family: "'Inter', 'PingFang SC', sans-serif" },
          padding: 10,
          cornerRadius: 6,
          ...((userOptions?.plugins as Record<string, unknown>)?.tooltip as Record<string, unknown>),
        },
      },
      scales: {
        ...defaults.scales,
        ...userOptions?.scales,
      },
    }),
    [userOptions],
  )

  const barOptions = useMemo(
    () =>
      mergedOptions({
        plugins: {
          legend: { display: data.datasets && data.datasets.length > 1 },
        },
        scales: {
          x: {
            grid: { color: 'rgba(64, 64, 64, 0.3)' },
            ticks: { color: '#a3a3a3', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(64, 64, 64, 0.3)' },
            ticks: { color: '#a3a3a3', font: { size: 11 } },
            beginAtZero: true,
          },
        },
      }),
    [mergedOptions, data.datasets],
  )

  const lineOptions = useMemo(
    () =>
      mergedOptions({
        plugins: {
          legend: { display: data.datasets && data.datasets.length > 1 },
        },
        scales: {
          x: {
            grid: { color: 'rgba(64, 64, 64, 0.3)' },
            ticks: { color: '#a3a3a3', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(64, 64, 64, 0.3)' },
            ticks: { color: '#a3a3a3', font: { size: 11 } },
          },
        },
      }),
    [mergedOptions, data.datasets],
  )

  const pieOptions = useMemo(
    () =>
      mergedOptions({
        plugins: {
          legend: { position: 'bottom' as const },
        },
        scales: undefined as unknown as ChartOptions['scales'],
      }),
    [mergedOptions],
  )

  const radarOptions = useMemo(
    () =>
      mergedOptions({
        scales: {
          r: {
            grid: { color: 'rgba(64, 64, 64, 0.5)' },
            angleLines: { color: 'rgba(64, 64, 64, 0.4)' },
            pointLabels: {
              color: '#a3a3a3',
              font: { size: 11, family: "'PingFang SC', 'Microsoft YaHei', sans-serif" },
            },
            ticks: {
              color: '#737373',
              backdropColor: 'transparent',
              font: { size: 10 },
            },
            suggestedMin: 0,
          },
        },
      }),
    [mergedOptions],
  )

  const chart = useMemo(() => {
    const defaultedData = {
      ...data,
      datasets: data.datasets?.map((ds) => ({
        ...ds,
        // Default colors for each dataset
        backgroundColor: ds.backgroundColor ?? undefined,
        borderColor: ds.borderColor ?? undefined,
        tension: (ds as unknown as { tension?: number }).tension ?? (resolvedType === 'line' ? 0.3 : undefined),
        fill: (ds as unknown as { fill?: boolean }).fill ?? (resolvedType === 'line' ? true : undefined),
      })),
    }

    // Apply chart-type-specific color defaults
    if (!data.datasets?.[0]?.backgroundColor) {
      defaultedData.datasets = defaultedData.datasets?.map((ds, i) => {
        if (resolvedType === 'line') {
          return {
            ...ds,
            borderColor: ds.borderColor ?? [RED, GREEN, '#2563eb', '#ca8a04'][i % 4],
            backgroundColor: ds.backgroundColor ?? [RED_LIGHT, GREEN_LIGHT, 'rgba(191, 219, 254, 0.3)', 'rgba(254, 243, 199, 0.3)'][i % 4],
          }
        }
        if (resolvedType === 'pie') {
          return {
            ...ds,
            backgroundColor: ds.backgroundColor ?? PIE_COLORS,
            borderColor: ds.borderColor ?? '#171717',
            borderWidth: (ds as unknown as { borderWidth?: number }).borderWidth ?? 2,
          }
        }
        if (resolvedType === 'radar') {
          return {
            ...ds,
            borderColor: ds.borderColor ?? [RED, '#2563eb', '#ca8a04'][i % 3],
            backgroundColor: ds.backgroundColor ?? ['rgba(220, 38, 38, 0.15)', 'rgba(37, 99, 235, 0.15)', 'rgba(202, 138, 4, 0.15)'][i % 3],
          }
        }
        return ds
      })
    }

    switch (resolvedType) {
      case 'line':
        return <Line data={defaultedData as never} options={lineOptions as never} />
      case 'pie':
        return <Pie data={defaultedData as never} options={pieOptions as never} />
      case 'radar':
        return <Radar data={defaultedData as never} options={radarOptions as never} />
      case 'bar':
      default:
        return <Bar data={defaultedData as never} options={barOptions as never} />
    }
  }, [resolvedType, data, barOptions, lineOptions, pieOptions, radarOptions])

  // Edge case: 空数据
  if (!data?.datasets?.length || !data?.labels?.length) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-neutral-500 text-sm', className)}>
        暂无图表数据
      </div>
    )
  }

  return (
    <div className={cn('w-full h-72 md:h-80', className)}>
      {chart}
    </div>
  )
}
