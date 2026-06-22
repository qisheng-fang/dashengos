// apps/web/src/screens/CustomModelManager.tsx · 自定义模型管理
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { Plus, Trash2, Check, X, Eye, EyeOff, Loader2 } from 'lucide-react'

interface CustomModel {
  id: string
  label: string
  providerName: string
  modelId: string
  baseUrl: string
  hasApiKey: boolean
  isActive: boolean
}

interface BuiltInModel {
  id: string
  label: string
  modelId: string
  providerName: string
  isCustom: boolean
}

export function CustomModelManager() {
  const [models, setModels] = useState<CustomModel[]>([])
  const [builtIn, setBuiltIn] = useState<BuiltInModel[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // 表单字段
  const [formLabel, setFormLabel] = useState('')
  const [formModelId, setFormModelId] = useState('')
  const [formBaseUrl, setFormBaseUrl] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formProviderName, setFormProviderName] = useState('custom')
  const [showApiKey, setShowApiKey] = useState(false)

  const token = useAuthStore((s) => s.accessToken) || ''

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const baseUrl = import.meta.env.VITE_API_URL || ''

  // 加载模型列表
  async function loadModels() {
    setLoading(true)
    try {
      const res = await fetch(`${baseUrl}/api/models`, { headers })
      const data = await res.json()
      setModels(data.custom || [])
      setBuiltIn(data.builtIn || [])
    } catch {} finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadModels() }, [])

  // 保存模型
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const body = {
      id: editingId || undefined,
      label: formLabel,
      providerName: formProviderName,
      modelId: formModelId,
      baseUrl: formBaseUrl || undefined,
      apiKey: formApiKey || undefined,
    }
    try {
      const res = await fetch(`${baseUrl}/api/models/custom`, {
        method: 'PUT', headers, body: JSON.stringify(body),
      })
      if (res.ok) {
        setShowAdd(false)
        setEditingId(null)
        resetForm()
        loadModels()
      }
    } catch {}
  }

  // 删除模型
  async function handleDelete(id: string) {
    if (!confirm('确定删除此自定义模型？')) return
    try {
      await fetch(`${baseUrl}/api/models/custom/${id}`, { method: 'DELETE', headers })
      loadModels()
    } catch {}
  }

  // 设为活跃
  async function handleSetActive(modelId: string, providerName: string) {
    try {
      await fetch(`${baseUrl}/api/models/active`, {
        method: 'PUT', headers,
        body: JSON.stringify({ modelId, providerName }),
      })
      loadModels()
    } catch {}
  }

  // 编辑
  function startEdit(m: CustomModel) {
    setFormLabel(m.label)
    setFormModelId(m.modelId)
    setFormBaseUrl(m.baseUrl || '')
    setFormApiKey('')
    setFormProviderName(m.providerName)
    setEditingId(m.id)
    setShowAdd(true)
  }

  function resetForm() {
    setFormLabel('')
    setFormModelId('')
    setFormBaseUrl('')
    setFormApiKey('')
    setFormProviderName('custom')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 当前活跃模型提示 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-200">自定义模型</h2>
          <p className="text-xs text-neutral-500 mt-1">添加你自己的 API Key 和模型端点，独立于内置 provider 运行</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAdd(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand/10 text-brand text-xs hover:bg-brand/20 transition-colors"
        >
          <Plus size={14} /> 添加模型
        </button>
      </div>

      {/* 添加/编辑表单 */}
      {showAdd && (
        <form onSubmit={handleSave} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-300">
              {editingId ? '编辑模型' : '添加自定义模型'}
            </span>
            <button type="button" onClick={() => { setShowAdd(false); setEditingId(null) }} className="text-neutral-500 hover:text-neutral-300">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">显示名称 *</label>
              <input
                value={formLabel}
                onChange={e => setFormLabel(e.target.value)}
                placeholder="如：我的 Qwen 2.5"
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Provider 名</label>
              <select
                value={formProviderName}
                onChange={e => setFormProviderName(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200"
              >
                <option value="custom">自定义 (custom)</option>
                <option value="siliconflow">SiliconFlow</option>
                <option value="deepseek">DeepSeek</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">模型 ID *</label>
              <input
                value={formModelId}
                onChange={e => setFormModelId(e.target.value)}
                placeholder="如：Qwen/Qwen2.5-72B-Instruct"
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">API 端点 (可选)</label>
              <input
                value={formBaseUrl}
                onChange={e => setFormBaseUrl(e.target.value)}
                placeholder="如：https://api.siliconflow.cn/v1"
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-brand"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-neutral-500 mb-1">API Key (可选)</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={formApiKey}
                  onChange={e => setFormApiKey(e.target.value)}
                  placeholder="sk-... (留空则使用 provider 默认 key)"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 pr-10 text-sm text-neutral-200 focus:outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="submit" className="px-4 py-1.5 rounded bg-brand text-black text-sm font-medium hover:bg-brand/80 transition-colors">
              {editingId ? '保存修改' : '添加'}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setEditingId(null) }} className="px-4 py-1.5 rounded bg-neutral-800 text-neutral-400 text-sm hover:bg-neutral-700 transition-colors">
              取消
            </button>
          </div>
        </form>
      )}

      {/* 模型列表 */}
      <div className="space-y-2">
        {models.length === 0 && !showAdd && (
          <div className="text-center py-8 text-neutral-600 text-sm">
            还没有自定义模型，点击上方「添加模型」按钮开始
          </div>
        )}

        {models.map(m => (
          <div
            key={m.id}
            className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
              m.isActive ? 'bg-brand/5 border-brand/30' : 'bg-neutral-900/50 border-neutral-800'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-200 truncate">{m.label}</span>
                {m.isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 text-brand border border-brand/20 flex-shrink-0">
                    当前使用
                  </span>
                )}
                {m.hasApiKey && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-400/10 text-green-400 border border-green-400/20 flex-shrink-0">
                    独立 Key
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                <span>{m.providerName}</span>
                <span>·</span>
                <span className="font-mono">{m.modelId}</span>
                {m.baseUrl && <><span>·</span><span>{new URL(m.baseUrl).hostname}</span></>}
              </div>
            </div>
            <div className="flex items-center gap-1 ml-3">
              {!m.isActive && (
                <button
                  onClick={() => handleSetActive(m.modelId, m.providerName)}
                  className="p-1.5 rounded text-neutral-500 hover:text-brand hover:bg-neutral-800 transition-colors"
                  title="设为当前使用"
                >
                  <Check size={14} />
                </button>
              )}
              <button
                onClick={() => startEdit(m)}
                className="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
                title="编辑"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button
                onClick={() => handleDelete(m.id)}
                className="p-1.5 rounded text-neutral-600 hover:text-red-400 hover:bg-neutral-800 transition-colors"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 内置模型提示 */}
      <div className="border-t border-neutral-800 pt-4 mt-4">
        <h3 className="text-xs text-neutral-600 uppercase tracking-wider mb-2">内置模型</h3>
        <p className="text-xs text-neutral-500 mb-2">
          内置模型使用 provider 环境变量中的 API Key，选中后直接使用无需额外配置。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {builtIn.map(m => (
            <button
              key={m.id}
              onClick={() => handleSetActive(m.modelId, m.providerName)}
              className="text-left px-3 py-2 rounded bg-neutral-900 border border-neutral-800 text-xs text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition-colors truncate"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
