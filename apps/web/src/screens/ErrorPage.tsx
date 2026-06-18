// apps/web/src/screens/ErrorPage.tsx · v0.3 spec §32.10
import { useTranslation } from 'react-i18next'
import { useParams } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Home, Bug } from 'lucide-react'

const EMOJI_MAP: Record<string, string> = {
  '404': '🦝',
  '500': '💥',
  '503': '🚧',
  'TOKEN_EXPIRED': '🔑',
  'RATE_LIMITED': '⏱️',
  default: '❓',
}

const MESSAGE_MAP: Record<string, string> = {
  '404': '404',
  '500': '500',
  '503': '503',
  default: 'error',
}

export function ErrorPage() {
  const { t } = useTranslation()
  const { code } = useParams({ from: '/error/$code' })
  const safeCode = code ?? '500'
  const emoji = EMOJI_MAP[safeCode] ?? EMOJI_MAP.default
  const messageKey = MESSAGE_MAP[safeCode] ?? MESSAGE_MAP.default

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <Card className="max-w-md w-full bg-neutral-900/50 border-neutral-800 p-8 text-center">
        <div className="text-7xl mb-4">{emoji}</div>
        <h1 className="text-4xl font-bold text-neutral-100 mb-2">{t(`error.${messageKey}`)}</h1>
        <p className="text-sm text-neutral-400 mb-6">
          {safeCode === '404' ? t('error.404Hint') : t('common.error')}
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild>
            <a href="/" className="inline-flex items-center gap-2">
              <Home size={16} aria-hidden="true" />
              {t('error.goHome')}
            </a>
          </Button>
          <Button variant="outline" leftIcon={<Bug size={16} aria-hidden="true" />}>
            {t('error.report')}
          </Button>
        </div>
        <p className="text-xs text-neutral-400 mt-6 font-mono">
          错误码: {safeCode} · 时间: {new Date().toISOString()} · Trace: a3f5d8…
        </p>
      </Card>
    </div>
  )
}
