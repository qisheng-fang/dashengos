// apps/web/src/screens/OpenMontage.tsx
// 管道式可视化编辑器 v2 — 可拖拽排序、增删阶段、参数全可控

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProjectContext } from '@/store/project-context'
import {
  Send, Loader2, Film, Music, Image, Type, Play, FolderOpen,
  ChevronDown, ChevronRight, RefreshCw, Pause, SkipForward,
  Eye, CheckCircle, XCircle, Clock, Zap,
  GripVertical, Plus, Trash2, ArrowUp, ArrowDown, Save, X
} from 'lucide-react'

const MONTAGE_PATH = '/Users/apple/Documents/Codex/OpenMontage'

// ── 类型 ──────────────────────────────────────
interface PipelineStage {
  id: string
  name: string
  icon: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused'
  artifacts: string[]
  params: Record<string, string>
  enabled: boolean
}

interface PipelinePreset {
  id: string; name: string; stages: PipelineStage[]
}

// ── 预设 ──────────────────────────────────────
const STAGE_TEMPLATES: Record<string, Omit<PipelineStage, 'status'|'artifacts'|'params'|'enabled'>> = {
  research:  { id:'research',  name:'调研',   icon:'🔍', description:'搜索参考、收集素材、分析竞品' },
  proposal:  { id:'proposal',  name:'方案',   icon:'📋', description:'生成多套创意方案供选择' },
  script:    { id:'script',    name:'脚本',   icon:'✍️', description:'分镜脚本 + 旁白文案' },
  scene:     { id:'scene',     name:'镜头',   icon:'🎬', description:'逐镜头视觉设计 + 动效规划' },
  asset:     { id:'asset',     name:'素材',   icon:'🖼️', description:'生成/收集图片视频音频素材' },
  edit:      { id:'edit',      name:'剪辑',   icon:'✂️', description:'时间线编排 + 转场 + 字幕' },
  compose:   { id:'compose',   name:'合成',   icon:'🎼', description:'配乐 + 调色 + 音效混音' },
  publish:   { id:'publish',   name:'导出',   icon:'📦', description:'渲染 MP4 + 质量检查' },
  review:    { id:'review',    name:'审核',   icon:'✅', description:'人工审核 + 修改意见' },
  thumbnail: { id:'thumbnail', name:'封面',   icon:'🖼️', description:'AI 生成视频封面/缩略图' },
  subtitle:  { id:'subtitle',  name:'字幕',   icon:'💬', description:'智能字幕生成 + 样式' },
}

function freshStage(key: string): PipelineStage {
  const t = STAGE_TEMPLATES[key] || STAGE_TEMPLATES.research
  return { ...t, status:'pending', artifacts:[], params:{}, enabled:true }
}

const DEFAULT_PIPELINE = [
  'research','proposal','script','scene','asset','edit','compose','publish'
].map(freshStage)

const SAVED_PRESETS_KEY = 'om_presets'

// ── 组件 ──────────────────────────────────────
export function OpenMontage() {
  const [mode, setMode] = useState<'quick' | 'pipeline'>('pipeline')
  const [stages, setStages] = useState<PipelineStage[]>(() => {
    try { const saved = localStorage.getItem('om_stages'); return saved ? JSON.parse(saved) : DEFAULT_PIPELINE }
    catch { return DEFAULT_PIPELINE }
  })
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'running' | 'paused'>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [chatInput, setChatInput] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [presets, setPresets] = useState<PipelinePreset[]>(() => {
    try { const s = localStorage.getItem(SAVED_PRESETS_KEY); return s ? JSON.parse(s) : [] }
    catch { return [] }
  })
  const [presetName, setPresetName] = useState('')

  const setProject = useProjectContext((s) => s.setProject)
  useEffect(() => {
    setProject({ id:'openmontage', name:'OpenMontage', path:MONTAGE_PATH })
    return () => setProject(null)
  }, [setProject])

  const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  // ── 保存 stages ──
  const saveStages = (s: PipelineStage[]) => {
    setStages(s)
    localStorage.setItem('om_stages', JSON.stringify(s))
  }

  // ── 执行单个阶段 ──
  const runStage = async (stageId: string) => {
    const idx = stages.findIndex(s => s.id === stageId)
    if (idx < 0) return
    const stage = stages[idx]
    setCurrentStage(stageId); setPipelineStatus('running')
    addLog(`▶ 开始: ${stage.name}`)

    saveStages(stages.map((s,i) => i===idx ? {...s,status:'running'} : i<idx ? s : {...s,status:'pending'}))

    const authRaw = localStorage.getItem('dasheng-auth')
    const token = authRaw ? JSON.parse(authRaw).accessToken || '' : ''
    const paramStr = Object.entries(stage.params).map(([k,v])=>`${k}=${v}`).join(', ')

    try {
      const resp = await fetch('/api/v1/chat/stream', {
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({
          message:`[OpenMontage pipeline] 阶段: ${stage.name} (${stage.id})\n项目路径: ${MONTAGE_PATH}\n参数: ${paramStr || '默认'}\n读取 pipeline_defs/ 和 skills/，执行此阶段。输出结果。`,
          history:[],
        }),
      })
      if (resp.body) {
        const reader = resp.body.getReader(); const decoder = new TextDecoder()
        let buffer='', text=''
        while (true) {
          const {done,value}=await reader.read(); if(done) break
          buffer+=decoder.decode(value,{stream:true})
          const lines=buffer.split('\n'); buffer=lines.pop()||''
          for (const line of lines) {
            if (line.startsWith('data:')) {
              try { const d=JSON.parse(line.slice(5)); if(d.c)text+=d.c; if(d.t?.includes('🔧'))addLog(d.t) } catch{}
            }
          }
        }
        addLog(`✅ ${stage.name} 完成`)
        saveStages(stages.map(s => s.id===stageId ? {...s,status:'completed',artifacts:[...s.artifacts,text.slice(0,300)]} : s))
      }
    } catch(e:any) {
      addLog(`❌ ${stage.name} 失败: ${e.message}`)
      saveStages(stages.map(s => s.id===stageId ? {...s,status:'failed'} : s))
    }
    setCurrentStage(null); setPipelineStatus('paused')
  }

  // ── 全部运行 ──
  const runFull = async () => {
    setPipelineStatus('running')
    for (const s of stages.filter(s=>s.enabled)) {
      await runStage(s.id)
      await new Promise(r=>setTimeout(r,500))
    }
    setPipelineStatus('idle')
  }

  // ── 阶段操作 ──
  const moveStage = (from:number, to:number) => {
    if (to<0||to>=stages.length) return
    const arr = [...stages]; const [item]=arr.splice(from,1); arr.splice(to,0,item)
    saveStages(arr)
  }
  const toggleStage = (idx:number) => saveStages(stages.map((s,i)=>i===idx?{...s,enabled:!s.enabled}:s))
  const removeStage = (idx:number) => saveStages(stages.filter((_,i)=>i!==idx))
  const addStage = (key:string) => {
    saveStages([...stages, freshStage(key)]); setShowAddMenu(false)
  }
  const updateParam = (stageId:string, key:string, val:string) => {
    saveStages(stages.map(s => s.id===stageId ? {...s, params:{...s.params,[key]:val}} : s))
  }
  const savePreset = () => {
    if (!presetName.trim()) return
    const p: PipelinePreset = { id:Date.now().toString(36), name:presetName, stages }
    const updated = [...presets.filter(x=>x.name!==presetName), p]
    setPresets(updated); localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(updated))
    setPresetName(''); addLog(`💾 保存预设: ${presetName}`)
  }
  const loadPreset = (p:PipelinePreset) => { saveStages(p.stages); addLog(`📂 加载预设: ${p.name}`) }
  const deletePreset = (id:string) => {
    const updated = presets.filter(x=>x.id!==id)
    setPresets(updated); localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(updated))
  }

  // ── 状态图标 ──
  const StatusIcon = ({s}:{s:PipelineStage['status']}) => {
    switch(s) {
      case 'completed': return <CheckCircle size={14} className="text-emerald-400" />
      case 'running':   return <Loader2 size={14} className="animate-spin text-brand" />
      case 'failed':    return <XCircle size={14} className="text-red-400" />
      case 'paused':    return <Pause size={14} className="text-amber-400" />
      default:          return <Clock size={14} className="text-neutral-600" />
    }
  }

  // ── UI ──
  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900 flex-shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-brand" />
          <span className="text-sm font-medium">OpenMontage</span>
          <div className="flex bg-neutral-800 rounded-md p-0.5">
            <button onClick={()=>setMode('pipeline')} className={`px-2 py-1 text-xs rounded ${mode==='pipeline'?'bg-brand/20 text-brand':'text-neutral-400'}`}>管道</button>
            <button onClick={()=>setMode('quick')} className={`px-2 py-1 text-xs rounded ${mode==='quick'?'bg-brand/20 text-brand':'text-neutral-400'}`}>快捷</button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 预设管理 */}
          <div className="flex items-center gap-1">
            <Input value={presetName} onChange={e=>setPresetName(e.target.value)} placeholder="预设名" className="h-7 w-20 text-xs bg-neutral-800 border-neutral-700" />
            <Button size="sm" variant="ghost" onClick={savePreset} disabled={!presetName.trim()} className="h-7"><Save size={12}/></Button>
          </div>
          <select onChange={e=>{const p=presets.find(x=>x.id===e.target.value); if(p)loadPreset(p)}} className="bg-neutral-800 border-neutral-700 text-xs rounded px-2 py-1 h-7" defaultValue="">
            <option value="" disabled>加载预设</option>
            {presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {/* 全量运行 */}
          <Button size="sm" variant="outline" onClick={runFull} disabled={pipelineStatus==='running'} className="text-xs h-7">
            {pipelineStatus==='running'?<Loader2 size={12} className="animate-spin mr-1"/>:<Play size={12} className="mr-1"/>}全部运行
          </Button>
          {/* 添加阶段 */}
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={()=>setShowAddMenu(!showAddMenu)} className="h-7"><Plus size={14}/></Button>
            {showAddMenu && (
              <div className="absolute right-0 top-8 z-50 bg-neutral-800 border border-neutral-700 rounded-lg p-2 w-40 shadow-xl space-y-1">
                {Object.entries(STAGE_TEMPLATES).map(([k,v])=>(
                  <button key={k} onClick={()=>addStage(k)} className="w-full text-left px-2 py-1 text-xs hover:bg-neutral-700 rounded flex items-center gap-2">
                    <span>{v.icon}</span><span>{v.name}</span>
                  </button>
                ))}
                <button onClick={()=>setShowAddMenu(false)} className="w-full text-left px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-700 rounded">取消</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === 'pipeline' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* 管道列表 */}
          <div className="flex-1 overflow-auto p-4">
            {/* 进度概览 */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-brand transition-all rounded-full"
                  style={{width:`${(stages.filter(s=>s.status==='completed').length/Math.max(1,stages.length))*100}%`}}/>
              </div>
              <span className="text-[10px] text-neutral-500">{stages.filter(s=>s.status==='completed').length}/{stages.length}</span>
            </div>

            {stages.map((stage, i) => (
              <Card key={`${stage.id}-${i}`}
                className={`border-neutral-800 bg-neutral-900/50 mb-2 transition-all ${!stage.enabled?'opacity-40':''} ${stage.status==='running'?'ring-1 ring-brand/50':''}`}
                draggable
                onDragStart={()=>setDragIdx(i)}
                onDragOver={e=>e.preventDefault()}
                onDrop={()=>{if(dragIdx!==null&&dragIdx!==i)moveStage(dragIdx,i);setDragIdx(null)}}>

                <div className="flex items-center gap-2 p-3">
                  {/* 拖拽手柄 */}
                  <button className="cursor-grab text-neutral-700 hover:text-neutral-400" title="拖拽排序">
                    <GripVertical size={14}/>
                  </button>
                  {/* 启用/禁用 */}
                  <button onClick={()=>toggleStage(i)} title={stage.enabled?'禁用':'启用'}>
                    <div className={`w-3 h-3 rounded-full border-2 ${stage.enabled?'bg-brand border-brand':'border-neutral-600'}`}/>
                  </button>

                  <button onClick={()=>setExpandedStage(expandedStage===`${stage.id}-${i}`?null:`${stage.id}-${i}`)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0">
                    <span className="text-lg">{stage.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{stage.name}</span>
                        <span className="text-[10px] text-neutral-600">#{i+1}</span>
                        <StatusIcon s={stage.status}/>
                      </div>
                      <p className="text-xs text-neutral-500 truncate">{stage.description}</p>
                    </div>
                    {expandedStage===`${stage.id}-${i}` ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                  </button>

                  {/* 快捷操作 */}
                  <div className="flex items-center gap-1">
                    <button onClick={()=>moveStage(i,i-1)} disabled={i===0} className="text-neutral-600 hover:text-neutral-300 disabled:opacity-30"><ArrowUp size={12}/></button>
                    <button onClick={()=>moveStage(i,i+1)} disabled={i===stages.length-1} className="text-neutral-600 hover:text-neutral-300 disabled:opacity-30"><ArrowDown size={12}/></button>
                    <button onClick={()=>removeStage(i)} className="text-neutral-600 hover:text-red-400"><Trash2 size={12}/></button>
                  </div>
                </div>

                {/* 展开面板 */}
                {expandedStage===`${stage.id}-${i}` && (
                  <div className="px-4 pb-3 space-y-3 border-t border-neutral-800 pt-3">
                    {/* 参数编辑 */}
                    <div>
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">可调参数</span>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        {/* 智能参数建议 */}
                        {stage.id==='research' && (
                          <>
                            <ParamField label="搜索关键词" value={stage.params['query']||''} onChange={v=>updateParam(stage.id,'query',v)} placeholder="产品/品牌/行业"/>
                            <ParamField label="风格参考" value={stage.params['style']||''} onChange={v=>updateParam(stage.id,'style',v)} placeholder="cinematic/corporate"/>
                          </>
                        )}
                        {stage.id==='script' && (
                          <>
                            <ParamField label="语调" value={stage.params['tone']||''} onChange={v=>updateParam(stage.id,'tone',v)} placeholder="专业/轻松/感人"/>
                            <ParamField label="时长(秒)" value={stage.params['duration']||''} onChange={v=>updateParam(stage.id,'duration',v)} placeholder="60"/>
                          </>
                        )}
                        {stage.id==='compose' && (
                          <>
                            <ParamField label="音乐风格" value={stage.params['music']||''} onChange={v=>updateParam(stage.id,'music',v)} placeholder="epic/ambient/upbeat"/>
                            <ParamField label="色彩预设" value={stage.params['grade']||''} onChange={v=>updateParam(stage.id,'grade',v)} placeholder="warm/cool/cinematic"/>
                          </>
                        )}
                        {stage.id==='publish' && (
                          <>
                            <ParamField label="格式" value={stage.params['format']||'mp4'} onChange={v=>updateParam(stage.id,'format',v)} placeholder="mp4"/>
                            <ParamField label="分辨率" value={stage.params['resolution']||'1920x1080'} onChange={v=>updateParam(stage.id,'resolution',v)} placeholder="1920x1080"/>
                          </>
                        )}
                        {/* 通用自定义参数 */}
                        <ParamField label="自定义参数" value={stage.params['custom']||''} onChange={v=>updateParam(stage.id,'custom',v)} placeholder="key=value"/>
                      </div>
                    </div>

                    {/* 产出物 */}
                    {stage.artifacts.length>0 && (
                      <div>
                        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">产出物</span>
                        <div className="mt-1.5 space-y-1">
                          {stage.artifacts.map((a,ai)=>(
                            <div key={ai} className="flex items-center gap-2 p-1.5 rounded bg-neutral-800/50 text-xs">
                              <Eye size={12} className="text-neutral-500 flex-shrink-0"/>
                              <span className="text-neutral-300 truncate">{a.slice(0,100)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 操作 */}
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button size="sm" variant="outline" className="text-xs h-7"
                        disabled={stage.status==='running'}
                        onClick={()=>{saveStages(stages.map(s=>s.id===stage.id?{...s,status:'pending'}:s));runStage(stage.id)}}>
                        <RefreshCw size={11} className="mr-1"/>{stage.status==='completed'?'重跑':'执行此阶段'}
                      </Button>
                      {stage.status==='running' && (
                        <Button size="sm" variant="ghost" className="text-xs h-7 text-amber-400" onClick={()=>setPipelineStatus('idle')}>
                          <Pause size={11} className="mr-1"/>暂停
                        </Button>
                      )}
                      {i<stages.length-1 && (
                        <Button size="sm" variant="ghost" className="text-xs h-7" onClick={()=>runStage(stages[i+1].id)}>
                          <SkipForward size={11} className="mr-1"/>下一阶段
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            ))}

            {/* 底部添加按钮 */}
            <button onClick={()=>setShowAddMenu(!showAddMenu)}
              className="w-full py-3 border-2 border-dashed border-neutral-800 rounded-lg text-xs text-neutral-600 hover:text-neutral-400 hover:border-neutral-700 transition-colors mt-2">
              <Plus size={14} className="inline mr-1"/>添加阶段
            </button>
          </div>

          {/* 右侧日志+聊天 */}
          <RightPanel logs={logs} chatInput={chatInput} setChatInput={setChatInput} currentStage={currentStage} runStage={runStage} />
        </div>
      ) : (
        <QuickMode />
      )}
    </div>
  )
}

// ── 参数输入 ──
function ParamField({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-neutral-500 w-16 flex-shrink-0">{label}</span>
      <Input value={value} onChange={e=>onChange(e.target.value)} className="h-7 text-xs bg-neutral-800 border-neutral-700 flex-1" placeholder={placeholder}/>
    </div>
  )
}

// ── 右侧面板 ──
function RightPanel({logs,chatInput,setChatInput,currentStage,runStage}:{
  logs:string[]; chatInput:string; setChatInput:(v:string)=>void; currentStage:string|null; runStage:(id:string)=>void
}) {
  return (
    <div className="w-80 border-l border-neutral-800 flex flex-col flex-shrink-0">
      <div className="flex-1 overflow-auto p-3 space-y-1">
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider px-1">运行日志</span>
        {logs.length===0 && <p className="text-xs text-neutral-600 p-2">点击阶段「执行」开始管道...</p>}
        {logs.slice(-40).map((l,i)=><div key={i} className="text-xs text-neutral-400 font-mono leading-relaxed">{l}</div>)}
      </div>
      <div className="p-3 border-t border-neutral-800">
        <div className="flex gap-2">
          <Input value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="自然语言修改指令..."
            className="flex-1 bg-neutral-800 border-neutral-700 text-xs h-8"
            onKeyDown={e=>{if(e.key==='Enter'&&currentStage){runStage(currentStage);setChatInput('')}}}/>
          <Button size="sm" onClick={()=>{if(currentStage){runStage(currentStage);setChatInput('')}}} disabled={!currentStage} className="h-8"><Send size={12}/></Button>
        </div>
        <p className="text-[10px] text-neutral-600 mt-1">输入「色调改暖色」「加背景音乐」等，当前阶段重跑</p>
      </div>
    </div>
  )
}

// ── 快捷模式 ──
function QuickMode() {
  const Q = [{id:'gen_video',label:'生成视频',icon:Film,desc:'文案→视频'},{id:'gen_music',label:'配乐',icon:Music,desc:'AI 背景音乐'},{id:'thumbnail',label:'封面',icon:Image,desc:'AI 缩略图'},{id:'script',label:'脚本',icon:Type,desc:'视频脚本'},{id:'preview',label:'预览',icon:Play,desc:'查看作品'},{id:'files',label:'文件',icon:FolderOpen,desc:'素材管理'}]
  const [p,setP]=useState(''); const [l,setL]=useState(false); const [s,setS]=useState('')
  async function exec(id:string){setS('执行中...');setL(true)
    try{const t=JSON.parse(localStorage.getItem('dasheng-auth')||'{}').accessToken||''
      await fetch('/api/v1/chat/stream',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${t}`},body:JSON.stringify({message:`[OpenMontage ${id}] 目录:${MONTAGE_PATH}\n需求:${p||'默认'}`,history:[]})})
      setS('完成')}catch(e:any){setS('失败:'+e.message)}finally{setL(false)}}
  return (<div className="flex-1 overflow-auto p-4 space-y-4">
    <div className="grid grid-cols-2 gap-2">{Q.map(a=><button key={a.id} onClick={()=>exec(a.id)} disabled={l} className="flex items-center gap-2 p-3 rounded-lg border border-neutral-800 bg-neutral-900/50 hover:border-neutral-700 transition-colors text-left disabled:opacity-50"><a.icon size={16} className="text-neutral-400"/><div><div className="text-sm">{a.label}</div><div className="text-xs text-neutral-500">{a.desc}</div></div></button>)}</div>
    <Card className="p-3 border-neutral-800 bg-neutral-900/50"><div className="flex gap-2"><Input value={p} onChange={e=>setP(e.target.value)} placeholder="描述视频/设计需求..." className="flex-1 bg-neutral-800 border-neutral-700 text-sm" onKeyDown={e=>e.key==='Enter'&&exec('gen_video')}/><Button onClick={()=>exec('gen_video')} disabled={l} size="sm">{l?<Loader2 size={14} className="animate-spin"/>:<Send size={14}/>}</Button></div></Card>
    {s&&<div className="text-xs text-neutral-400 px-2">{s}</div>}
  </div>)
}
