// apps/web/src/components/ErrorBoundary.tsx · Phase 3 (2026-06-17)
// 全局异常兜底 — 组件 crash 时不白屏，显示可恢复的错误页
import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack?.slice(0, 300))
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return <DefaultErrorFallback error={this.state.error} onRetry={() => this.setState({ hasError: false, error: null })} />
    }
    return this.props.children
  }
}

function DefaultErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-xl font-semibold text-neutral-200">
          {t('error.unexpected', 'Something went wrong')}
        </h1>
        <p className="text-sm text-neutral-400">
          {error?.message ?? t('error.unknown', 'An unexpected error occurred')}
        </p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
        >
          🔄 {t('error.retry', 'Try Again')}
        </button>
        <p className="text-xs text-neutral-600 mt-4">
          {t('error.persist', 'If this persists, please reload the page or contact support.')}
        </p>
      </div>
    </div>
  )
}
