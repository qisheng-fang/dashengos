// apps/web/src/screens/SkillDetail.tsx · v0.3 Phase 5+ (real backend)
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { http } from '@/lib/api'

interface SkillDetail {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  manifest: string
  body: string
}

export function SkillDetail() {
  const { t } = useTranslation()
  const { id } = useParams({ from: '/_workspace/skills/$id' })
  const [skill, setSkill] = useState<SkillDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await http.get<SkillDetail>(`/api/v1/skills/${encodeURIComponent(id)}`)
        if (cancelled) return
        setSkill(res)
      } catch {
        // 后端不可达时静默 fallback, UI 会显示 "未找到" 占位
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link
        to="/agents"
        className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-100 mb-4"
      >
        <ArrowLeft size={14} aria-hidden="true" /> 返回
      </Link>

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> 加载 skill…
        </div>
      ) : error ? (
        <Card className="bg-neutral-900/50 border-neutral-800 p-4">
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        </Card>
      ) : skill ? (
        <>
          <Card className="bg-neutral-900/50 border-neutral-800 mb-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl text-neutral-100">Skill: {skill.id}</CardTitle>
                  <div className="mt-2 flex items-center gap-3 text-sm text-neutral-400 flex-wrap">
                    {skill.category && <Badge variant="outline">{skill.category}</Badge>}
                    {skill.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="bg-neutral-900/50 border-neutral-800 mb-4">
            <CardHeader>
              <CardTitle className="text-base text-neutral-100">描述</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-300">{skill.description}</p>
            </CardContent>
          </Card>

          {skill.manifest && (
            <Card className="bg-neutral-900/50 border-neutral-800 mb-4">
              <CardHeader>
                <CardTitle className="text-base text-neutral-100">SKILL.md manifest</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-neutral-300 font-mono whitespace-pre-wrap break-words">
                  {skill.manifest}
                </pre>
              </CardContent>
            </Card>
          )}

          {skill.body && (
            <Card className="bg-neutral-900/50 border-neutral-800 mb-4">
              <CardHeader>
                <CardTitle className="text-base text-neutral-100">正文 (body.md)</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm text-neutral-200 whitespace-pre-wrap break-words">
                  {skill.body}
                </pre>
              </CardContent>
            </Card>
          )}

          <Separator className="my-4 bg-neutral-800" />

          <div className="flex gap-2">
            <Button onClick={() => alert('TODO: 安装到 agent')}>{t('skill.install')}</Button>
            <Button variant="outline" onClick={() => alert('TODO: 在 agent 中测试')}>
              {t('skill.testInAgent')}
            </Button>
            <Button variant="ghost" className="text-semantic-danger" onClick={() => alert('TODO: 举报')}>
              {t('skill.report')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
