// comfyui/ComfyUINode.tsx · React Flow 自定义节点 (ComfyUI 节点)
// ----------------------------------------------------------------------
// 渲染规则:
//   - 颜色编码: 模型=紫色 / 采样=蓝色 / 条件=橙色 / 图片=绿色 / 输出=青色
//   - 模型槽位节点: 虚线边框 + "待配置"角标 (配置后消失)
//   - widgets_values 显示为只读标签
// ----------------------------------------------------------------------

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertCircle, Cpu, Palette, Wand2, Image, FileOutput, Boxes, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 节点数据类型 */
export interface ComfyUINodeData {
  classType: string
  widgetValues: Record<string, unknown>
  inputs: Array<{ name: string; type: string; linked: boolean }>
  outputs: Array<{ name: string; type: string }>
  isModelSlot: boolean
  modelSlotType?: import('./parser').ModelSlotType
  category: 'model' | 'sample' | 'conditioning' | 'image' | 'latent' | 'output' | 'other'
  rawId: number
}

const CATEGORY_STYLE: Record<ComfyUINodeData['category'], { bg: string; border: string; icon: typeof Cpu }> = {
  model:      { bg: 'bg-purple-500/10', border: 'border-purple-500/40', icon: Cpu },
  sample:     { bg: 'bg-blue-500/10',    border: 'border-blue-400/40',   icon: Wand2 },
  conditioning:{ bg: 'bg-amber-500/10',   border: 'border-amber-400/40',  icon: Palette },
  image:      { bg: 'bg-emerald-500/10',  border: 'border-emerald-400/40',icon: Image },
  latent:     { bg: 'bg-cyan-500/10',     border: 'border-cyan-400/40',   icon: Boxes },
  output:     { bg: 'bg-teal-500/10',     border: 'border-teal-400/40',   icon: FileOutput },
  other:      { bg: 'bg-neutral-800/50',  border: 'border-neutral-700',   icon: Boxes },
}

const SLOT_TYPE_LABEL: Record<string, string> = {
  checkpoint: 'Checkpoint',
  unet: 'UNet',
  clip: 'CLIP',
  lora: 'LoRA',
  vae: 'VAE',
  sampler: 'Sampler',
  controlnet: 'ControlNet',
}

function ComfyUINode(props: NodeProps) {
  const data = (props.data as unknown) as ComfyUINodeData
  const cat = CATEGORY_STYLE[data.category]
  const Icon = cat.icon
  const isConfigured = !data.isModelSlot || isSlotConfigured(data)

  // 只显示关键 widget 值 (过滤掉空值和过长值)
  const displayWidgets = Object.entries(data.widgetValues)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .filter(([k]) => !['model', 'clip', 'positive', 'negative', 'vae', 'images', 'samples'].includes(k))
    .slice(0, 5)

  return (
    <div
      className={cn(
        'min-w-[180px] max-w-[260px] rounded-lg border backdrop-blur-sm transition-all',
        data.isModelSlot && !isConfigured ? 'border-dashed border-2 border-yellow-400/60' : `border ${cat.border}`,
        cat.bg,
        'shadow-lg',
      )}
    >
      {/* 头部 */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/5">
        <Icon size={13} className={cn(
          data.category === 'model' ? 'text-purple-400' :
          data.category === 'sample' ? 'text-blue-400' :
          data.category === 'conditioning' ? 'text-amber-400' :
          data.category === 'image' ? 'text-emerald-400' :
          data.category === 'output' ? 'text-teal-400' : 'text-neutral-500'
        )} />
        <span className="text-xs font-medium text-neutral-200 truncate">{data.classType}</span>
        <span className="text-[10px] text-neutral-600 ml-auto">#{data.rawId}</span>
        {/* 待配置标记 */}
        {data.isModelSlot && !isConfigured && (
          <AlertCircle size={12} className="text-yellow-400 flex-shrink-0" />
        )}
      </div>

      {/* Slot 类型标签 */}
      {data.isModelSlot && (
        <div className="px-2.5 pt-1">
          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-300 border border-yellow-400/25">
            {SLOT_TYPE_LABEL[data.modelSlotType ?? ''] ?? '模型'}
            {!isConfigured && <span>· 待配置</span>}
          </span>
        </div>
      )}

      {/* Widget 参数显示 */}
      {displayWidgets.length > 0 && (
        <div className="px-2.5 py-1.5 space-y-0.5">
          {displayWidgets.map(([key, val]) => (
            <div key={key} className="flex items-center justify-between text-[10px] min-w-0">
              <span className="text-neutral-500 truncate mr-2 shrink-0">{key}</span>
              <span className="text-neutral-400 font-mono truncate" title={String(val)}>
                {formatWidgetValue(val)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 输出图片占位 (SaveImage / PreviewImage) */}
      {data.category === 'output' && (
        <div className="m-2 mt-1 h-20 rounded bg-neutral-900/80 border border-neutral-800 flex items-center justify-center">
          <Image size={16} className="text-neutral-700" />
          <span className="text-[10px] text-neutral-700 ml-1">输出预览</span>
        </div>
      )}

      {/* Input Handles (左侧) */}
      {data.inputs.map((inp, i) => (
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Left}
          id={`in_${i}`}
          style={{
            background: inp.linked ? '#6366f1' : '#555',
            width: 8,
            height: 8,
            top: `${Math.max(30, (i + 1) * 22)}px`,
          }}
        />
      ))}

      {/* Output Handles (右侧) */}
      {data.outputs.map((_, i) => (
        <Handle
          key={`out-${i}`}
          type="source"
          position={Position.Right}
          id={`out_${i}`}
          style={{
            background: '#22c55e',
            width: 8,
            height: 8,
            top: `${Math.max(30, (i + 1) * 22)}px`,
          }}
        />
      ))}

      {/* 底部操作提示 */}
      {data.isModelSlot && !isConfigured && (
        <div className="px-2.5 pb-2 pt-0.5">
          <button className="flex items-center gap-1 text-[10px] text-yellow-400/70 hover:text-yellow-300 transition-colors">
            点击右侧面板配置模型
            <ChevronRight size={10} />
          </button>
        </div>
      )}
    </div>
  )
}

/** 判断模型槽位是否已配置 (有非空的模型名) */
function isSlotConfigured(data: ComfyUINodeData): boolean {
  const ckpt = data.widgetValues.ckpt_name as string | undefined
  const unet = data.widgetValues.unet_name as string | undefined
  const lora = data.widgetValues.lora_name as string | undefined
  const clip = data.widgetValues.clip_name as string | undefined
  const vae = data.widgetValues.vae_name as string | undefined
  return Boolean(ckpt || unet || lora || clip || vae)
}

/** 格式化 widget 值用于显示 */
function formatWidgetValue(val: unknown): string {
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : val.toFixed(2)
  }
  const s = String(val)
  return s.length > 18 ? s.slice(0, 17) + '…' : s
}

export default memo(ComfyUINode)
