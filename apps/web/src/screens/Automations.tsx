// apps/web/src/screens/Automations.tsx · DaShengOS v8.6
// 自动化任务管理 — CRUD + trigger + 运行历史

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { http } from '@/lib/api'
import { Clock, Play, Pause, Trash2, Plus, RefreshCw, CheckCircle, XCircle, Timer } from 'lucide-react'

interface Automation {
  id: string; name: string; trigger: string; action: string;
  schedule?: string; enabled: boolean; lastRun?: string; nextRun?: string;
  runCount: number; errorCount: number;
}

export function Automations() {
  const [items, setItems] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', trigger: 'manual', action: '', schedule: '' })

  const fetchItems = async () => {
    setLoading(true)
    try { const { data } = await http.get('/api/v1/automations'); setItems(data || []) } catch { /* ok */ }
    setLoading(false)
  }

  useEffect(() => { fetchItems() }, [])

  const create = async () => {
    await http.post('/api/v1/automations', form)
    setShowForm(false); setForm({ name: '', trigger: 'manual', action: '', schedule: '' })
    fetchItems()
  }

  const toggle = async (id: string, enabled: boolean) => {
    await http.put('/api/v1/automations/' + id, { enabled: !enabled })
    fetchItems()
  }

  const remove = async (id: string) => {
    if (!confirm('确定删除?')) return
    await http.delete('/api/v1/automations/' + id)
    fetchItems()
  }

  const trigger = async (id: string) => {
    await http.post('/api/v1/automations/' + id + '/trigger')
    fetchItems()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">自动化任务</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-2" />新建任务
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <Input placeholder="任务名称" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            <Input placeholder="触发条件 (manual/cron/webhook)" value={form.trigger} onChange={e => setForm({...form, trigger: e.target.value})} />
            <Input placeholder="执行动作" value={form.action} onChange={e => setForm({...form, action: e.target.value})} />
            <Input placeholder="调度表达式 (可选，如 0 */6 * * *)" value={form.schedule} onChange={e => setForm({...form, schedule: e.target.value})} />
            <div className="flex gap-2">
              <Button onClick={create} disabled={!form.name || !form.action}>创建</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? <div className="text-muted-foreground">加载中...</div> : items.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">暂无自动化任务，点击"新建任务"创建</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {items.map(item => (
            <Card key={item.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{item.name}</span>
                    <Badge variant={item.enabled ? 'default' : 'secondary'}>
                      {item.enabled ? <CheckCircle className="w-3 h-3 mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                      {item.enabled ? '运行中' : '已停用'}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground flex gap-3">
                    <span><Clock className="w-3 h-3 inline mr-1" />{item.trigger}</span>
                    <span>执行 {item.runCount || 0} 次</span>
                    {item.errorCount > 0 && <span className="text-red-500"><XCircle className="w-3 h-3 inline mr-1" />{item.errorCount} 错误</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => trigger(item.id)}><Play className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(item.id, item.enabled)}>
                    {item.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(item.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
