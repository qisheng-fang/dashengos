// comfyui/ModelConfigPanel.tsx · 模型配置面板 (右侧抽屉)
// ----------------------------------------------------------------------
// 显示导入工作流中所有需要配置的模型槽位
// 每个槽位: 节点名 + 类型标签 + 模型下拉选择 + LoRA 强度滑块
// 配置完成后更新 ComfyNode.widgetValues → 画布节点实时更新
// ----------------------------------------------------------------------

import { useState } from 'react'
import { X, Cpu, Wand2, Palette, Image, Boxes, ShieldCheck, AlertTriangle } from 'lucide-react'
import type { ModelSlot, ModelSlotType } from './parser'
import { cn } from '@/lib/utils'

export interface ModelConfigPanelProps {
  slots: ModelSlot[]
  isOpen: boolean
  onClose: () => void
  /** 配置变更回调 */
  onConfigChange: (nodeId: string, updates: Record<string, unknown>) => void
  /** 全部配置完成 */
  onReady?: () => void
}

const SLOT_ICON: Record<ModelSlotType, typeof Cpu> = {
  checkpoint: Cpu,
  unet: Cpu,
  clip: Palette,
  lora: Wand2,
  vae: Image,
  sampler: Wand2,
  controlnet: ShieldCheck,
}

const SLOT_COLOR: Record<ModelSlotType, string> = {
  checkpoint: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  unet:      'text-purple-400 bg-purple-500/10 border-purple-500/30',
  clip:      'text-amber-400 bg-amber-500/10 border-amber-500/30',
  lora:      'text-blue-400 bg-blue-500/10 border-blue-500/30',
  vae:       'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  sampler:   'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  controlnet:'text-teal-400 bg-teal-500/10 border-teal-500/30',
}

const SLOT_LABEL: Record<ModelSlotType, string> = {
  checkpoint: 'Checkpoint 模型',
  unet: 'UNet 模型',
  clip: 'CLIP 文本编码器',
  lora: 'LoRA 微调模型',
  vae: 'VAE 解码器',
  sampler: '采样器参数',
  controlnet: 'ControlNet 控制网络',
}

/** 单个槽位配置行 */
function SlotConfigRow({
  slot,
  onChange,
}: {
  slot: ModelSlot
  onChange: (nodeId: string, updates: Record<string, unknown>) => void
}) {
  const [selectedModel, setSelectedModel] = useState(slot.currentValue ?? '')
  const [loraStrength, setLoraStrength] = useState(
    ((slot.extraParams?.strength_model as number) ?? 0.8) * 100
  )
  const Icon = SLOT_ICON[slot.slotType]

  function handleSelectModel(modelName: string) {
    setSelectedModel(modelName)
    // 根据 slotType 决定写入哪个字段
    const fieldMap: Partial<Record<ModelSlotType, string>> = {
      checkpoint: 'ckpt_name',
      unet: 'unet_name',
      clip: 'clip_name',
      lora: 'lora_name',
      vae: 'vae_name',
    }
    const field = fieldMap[slot.slotType]
    if (field) {
      onChange(slot.nodeId, { [field]: modelName })
    }
    // LoRA 额外写 strength
    if (slot.slotType === 'lora') {
      onChange(slot.nodeId, {
        strength_model: loraStrength / 100,
        strength_clip: loraStrength / 100,
      })
    }
  }

  function handleStrengthChange(val: number) {
    setLoraStrength(val)
    if (slot.slotType === 'lora') {
      onChange(slot.nodeId, {
        strength_model: val / 100,
        strength_clip: val / 100,
      })
    }
  }

  const isConfigured = selectedModel.length > 0

  return (
    <div className={cn(
      "p-3 rounded-lg border transition-all",
      isConfigured ? SLOT_COLOR[slot.slotType] : 'bg-yellow-500/5 border-yellow-500/25'
    )}>
      {/* 头部 */}
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={isConfigured ? '' : 'text-yellow-400'} />
        <span className="text-xs font-medium text-neutral-200 truncate">{slot.nodeLabel}</span>
        <span className={cn(
          "text-[9px] px-1.5 py-0.5 rounded-full ml-auto",
          isConfigured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-yellow-500/15 text-yellow-300'
        )}>
          {SLOT_LABEL[slot.slotType]}
        </span>
      </div>

      {/* 模型下拉 */}
      <select
        value={selectedModel}
        onChange={(e) => handleSelectModel(e.target.value)}
        className="w-full text-xs bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-neutral-200 focus:border-brand outline-none"
      >
        <option value="">-- 选择模型 --</option>
        {slot.availableModels.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {/* LoRA 强度滑块 */}
      {slot.slotType === 'lora' && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-[10px] text-neutral-500">
            <span>强度</span>
            <span>{Math.round(loraStrength)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={150}
            step={1}
            value={loraStrength}
            onChange={(e) => handleStrengthChange(Number(e.target.value))}
            className="w-full h-1 bg-neutral-800 rounded appearance-none cursor-pointer accent-brand"
          />
        </div>
      )}

      {/* KSampler 参数微调 */}
      {slot.slotType === 'sampler' && (
        <SamplerParamsPreview nodeId={slot.nodeId} onChange={onChange} />
      )}

      {!isConfigured && (
        <p className="text-[10px] text-yellow-400/70 mt-1.5 flex items-center gap-1">
          <AlertTriangle size={10} />
          此槽位未配置，执行时将报错
        </p>
      )}
    </div>
  )
}

/** KSampler 参数预览 (只读展示，可编辑) */
function SamplerParamsPreview({
  nodeId,
  onChange,
}: {
  nodeId: string
  onChange: (nodeId: string, updates: Record<string, unknown>) => void
}) {
  const [steps, setSteps] = useState(20)
  const [cfg, setCfg] = useState(7)

  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      <div>
        <label className="text-[9px] text-neutral-600 block mb-0.5">步数</label>
        <input
          type="number"
          min={1}
          max={150}
          value={steps}
          onChange={(e) => { setSteps(+e.target.value); onChange(nodeId, { steps: +e.target.value }) }}
          className="w-full text-[11px] bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200"
        />
      </div>
      <div>
        <label className="text-[9px] text-neutral-600 block mb-0.5">CFG</label>
        <input
          type="number"
          min={1}
          max={30}
          step={0.5}
          value={cfg}
          onChange={(e) => { setCfg(+e.target.value); onChange(nodeId, { cfg: +e.target.value }) }}
          className="w-full text-[11px] bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200"
        />
      </div>
      <div className="col-span-3 mt-1">
        <label className="text-[9px] text-neutral-600 block mb-0.5">采样器</label>
        <select
          onChange={(e) => onChange(nodeId, { sampler_name: e.target.value })}
          className="w-full text-[11px] bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200"
        >
          {['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function ModelConfigPanel({ slots, isOpen, onClose, onConfigChange }: ModelConfigPanelProps) {
  const configuredCount = slots.filter((s) =>
    s.currentValue || s.availableModels.includes(s.currentValue)
  ).length

  if (!isOpen || slots.length === 0) return null

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      )}
      
      {/* Panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 w-80 bg-neutral-950 border-l border-neutral-800 shadow-2xl",
          "flex flex-col transition-transform duration-200",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">模型配置</h3>
            <p className="text-[10px] text-neutral-500">{configuredCount}/{slots.length} 已配置</p>
          </div>
          <button onClick={onClose} className="text-neutral-600 hover:text-neutral-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Slots list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {slots.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-600">
              <Boxes size={24} className="mb-2 opacity-30" />
              <p className="text-xs">无需配置模型的纯数据工作流</p>
            </div>
          ) : (
            slots.map((slot) => (
              <SlotConfigRow key={slot.nodeId} slot={slot} onChange={onConfigChange} />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-neutral-800">
          {configuredCount < slots.length ? (
            <div className="text-[10px] text-amber-400/80 flex items-center gap-1 p-2 rounded bg-amber-500/5 border border-amber-500/15">
              <AlertTriangle size={11} />
              还有 {slots.length - configuredCount} 个槽位未配置
            </div>
          ) : (
            <div className="text-[10px] text-emerald-400 flex items-center gap-1 p-2 rounded bg-emerald-500/5 border border-emerald-500/15">
              <ShieldCheck size={11} />
              所有模型已配置完毕，可以运行工作流
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
