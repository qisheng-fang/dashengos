// comfyui/parser.ts · ComfyUI 工作流 JSON 解析器
// ----------------------------------------------------------------------
// 支持两种格式:
//   1) ComfyUI UI export 格式 (前端导出, 有 nodes[] + links[])
//   2) ComfyUI API format (workflow_api.json, 提交格式)
//
// 输出:
//   - ComfyNode[]  → ReactFlow Node[] 的中间表示
//   - ComfyEdge[]  → ReactFlow Edge[] 的中间表示
//   - ModelSlot[]  → 需要用户配置模型的槽位清单
// ----------------------------------------------------------------------

import type { Node, Edge } from '@xyflow/react'

// ---- 类型定义 ----

/** ComfyUI 原始节点 (UI export 格式) */
interface RawUINode {
  id: number
  type: string
  pos: [number, number]
  size?: [number, number]
  flags?: Record<string, unknown>
  order?: number
  mode?: number
  inputs?: Array<{
    name: string
    type: string
    link: number | null
  }>
  outputs?: Array<{
    name: string
    type: string
    links: number[]
    slot_index?: number
  }>
  properties?: Record<string, unknown>
  widgets_values?: unknown[]
}

/** ComfyUI 原始连线 (UI export 格式) */
interface RawUILink {
  id: number
  type: string
  origin_id: number
  origin_slot: number
  target_id: number
  target_slot: number
}

/** ComfyUI API format 节点 */
interface RawAPINode {
  class_type: string
  inputs: Record<string, unknown | [number, number]>
}

/** 中间节点表示 */
export interface ComfyNode {
  /** 原始节点 ID (ComfyUI 用数字) */
  rawId: number
  /** React Flow 内部 ID */
  id: string
  /** ComfyUI 节点类型名 (class_type) */
  classType: string
  /** 画布位置 */
  position: { x: number; y: number }
  /** 节点参数值 (widgets_values 或 inputs 中的字面量) */
  widgetValues: Record<string, unknown>
  /** 该节点的输入 (用于渲染 handles) */
  inputs: Array<{ name: string; type: string; linked: boolean }>
  /** 该节点的输出 (用于渲染 handles) */
  outputs: Array<{ name: string; type: string }>
  /** 是否是模型槽位节点 (需要用户配置) */
  isModelSlot: boolean
  /** 模型槽位类型 */
  modelSlotType?: ModelSlotType
  /** 分类颜色编码 */
  category: 'model' | 'sample' | 'conditioning' | 'image' | 'latent' | 'output' | 'other'
}

/** 中间边表示 */
export interface ComfyEdge {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  sourceRawId: number
  targetRawId: number
}

/** 模型槽位类型 */
export type ModelSlotType =
  | 'checkpoint'      // CheckpointLoaderSimple / CheckpointLoader
  | 'unet'            // UNETLoader / DualCLIPLoader 等
  | 'clip'            // CLIPLoader / DualCLIPLoader 的 clip 部分
  | 'lora'            // LoraLoader / LoraLoaderModelOnly
  | 'vae'             // VAELoader / VAEDecode
  | 'sampler'         // KSampler / KSamplerAdvanced
  | 'controlnet'      // ControlNetApply / LoadControlNet

export interface ModelSlot {
  nodeId: string
  nodeLabel: string
  nodeClassType: string
  slotType: ModelSlotType
  currentValue: string        // 当前配置的模型名 (可能为空)
  availableModels: string[]   // 可选模型列表 (后端提供)
  extraParams?: Record<string, unknown>  // LoRA strength 等
}

/** 解析结果 */
export interface ParsedWorkflow {
  nodes: ComfyNode[]
  edges: ComfyEdge[]
  modelSlots: ModelSlot[]
  workflowName: string
  format: 'ui_export' | 'api_format'
  totalNodes: number
}

// ---- 模型槽位识别规则 ----

const MODEL_NODE_RULES: Array<{
  patterns: RegExp[]
  slotType: ModelSlotType
  category: ComfyNode['category']
}> = [
  { patterns: [/CheckpointLoader/i], slotType: 'checkpoint', category: 'model' },
  { patterns: [/UNETLoader/i, /UNETLoaderGGUF/i], slotType: 'unet', category: 'model' },
  { patterns: [/CLIPLoader/i, /DualCLIPLoader/i], slotType: 'clip', category: 'model' },
  { patterns: [/LoraLoader/i], slotType: 'lora', category: 'model' },
  { patterns: [/VAELoader/i], slotType: 'vae', category: 'model' },
  { patterns: [/ControlNetLoad|LoadControlNet/i], slotType: 'controlnet', category: 'model' },
  { patterns: [/KSampler|SamplerCustom/i], slotType: 'sampler', category: 'sample' },
]

function detectModelSlot(classType: string): { isModelSlot: boolean; slotType?: ModelSlotType; category: ComfyNode['category'] } {
  for (const rule of MODEL_NODE_RULES) {
    if (rule.patterns.some((p) => p.test(classType))) {
      return { isModelSlot: true, slotType: rule.slotType, category: rule.category }
    }
  }

  // 非模型节点分类
  if (/VAEDecode|VAEEncode/i.test(classType)) return { isModelSlot: false, category: 'image' }
  if (/EmptyLatentImage|LatentUpscale|LatentComposite/i.test(classType)) return { isModelSlot: false, category: 'latent' }
  if (/CLIPTextEncode|CLIPVisionEncode| ConditioningCombine|ConditioningSetArea/i.test(classType)) return { isModelSlot: false, category: 'conditioning' }
  if (/SaveImage|SaveAnimatedWEBP|PreviewImage|ImageBatch|ImageScale/i.test(classType)) return { isModelSlot: false, category: 'output' }
  if (/ImageOnlyCheckpointSave/i.test(classType)) return { isModelSlot: false, category: 'output' }
  if (/LoadImage|LoadImageMask/i.test(classType)) return { isModelSlot: false, category: 'image' }

  return { isModelSlot: false, category: 'other' }
}

// ---- 主解析函数 ----

/**
 * 解析 ComfyUI 工作流 JSON
 * 自动检测格式 (UI export vs API format)
 */
export function parseWorkflowJson(json: unknown): ParsedWorkflow {
  const data = json as Record<string, unknown>

  // 格式检测: UI export 有 "nodes" 数组 (元素有 id/type/pos)
  const hasUINodes = Array.isArray(data.nodes) &&
    data.nodes.length > 0 &&
    typeof data.nodes[0] === 'object' &&
    'pos' in (data.nodes[0] as object)

  if (hasUINodes) {
    return parseUIExportFormat(data)
  }

  // API format: 顶层是 { "1": { class_type, inputs }, "2": {...}, ... }
  return parseAPIFormat(data)
}

/** 解析 ComfyUI UI export 格式 (前端导出 .json) */
function parseUIExportFormat(data: Record<string, unknown>): ParsedWorkflow {
  const rawNodes = data.nodes as RawUINode[]
  const rawLinks = (data.links ?? []) as RawUILink[][]

  // 构建 link → target 映射
  const linkMap = new Map<number, RawUILink>()
  ;(Array.isArray(rawLinks[0]) ? rawLinks[0] : rawLinks as unknown as RawUILink[]).forEach((link) => {
    linkMap.set(link.id, link)
  })

  // 解析节点
  const comfyNodes: ComfyNode[] = []
  const modelSlots: ModelSlot[] = []

  for (const rn of rawNodes) {
    const id = `comfy_${rn.id}`
    const { isModelSlot, slotType, category } = detectModelSlot(rn.type)

    // 从 widgets_values 提取参数
    const widgetValues: Record<string, unknown> = {}
    if (Array.isArray(rn.widgets_values)) {
      // 标准输入名列表 (根据 class_type 推断)
      const inputNames = getInputNamesForClass(rn.type)
      rn.widgets_values.forEach((val, idx) => {
        if (idx < inputNames.length) {
          widgetValues[inputNames[idx]] = val
        }
      })
    }

    // 提取 inputs/outputs
    const inputs = (rn.inputs ?? []).map((inp) => ({
      name: inp.name,
      type: inp.type,
      linked: inp.link !== null && linkMap.has(inp.link ?? -1),
    }))
    const outputs = (rn.outputs ?? []).map((out) => ({
      name: out.name,
      type: out.type,
    }))

    const node: ComfyNode = {
      rawId: rn.id,
      id,
      classType: rn.type,
      position: { x: rn.pos[0], y: rn.pos[1] },
      widgetValues,
      inputs,
      outputs,
      isModelSlot,
      modelSlotType: slotType,
      category,
    }
    comfyNodes.push(node)

    // 收集模型槽位
    if (isModelSlot && slotType) {
      modelSlots.push({
        nodeId: id,
        nodeLabel: `${rn.type} #${rn.id}`,
        nodeClassType: rn.type,
        slotType,
        currentValue: (widgetValues.ckpt_name ?? widgetValues.unet_name ?? widgetValues.clip_name ?? widgetValues.lora_name ?? widgetValues.vae_name ?? '') as string,
        availableModels: getMockModels(slotType), // TODO: 后端 GET /api/v1/comfy/models 替换
        extraParams: slotType === 'lora' ? { strength_model: widgetValues.strength_model ?? 0.8, strength_clip: widgetValues.strength_clip ?? 0.8 } : undefined,
      })
    }
  }

  // 解析连线
  const edges: ComfyEdge[] = []
  const idToRFId = new Map(comfyNodes.map((n) => [n.rawId, n.id]))

  for (const [, link] of linkMap) {
    const srcId = idToRFId.get(link.origin_id)
    const tgtId = idToRFId.get(link.target_id)
    if (!srcId || !tgtId) continue
    edges.push({
      id: `ce_${link.id}`,
      source: srcId,
      target: tgtId,
      sourceHandle: `out_${link.origin_slot}`,
      targetHandle: `in_${link.target_slot}`,
      sourceRawId: link.origin_id,
      targetRawId: link.target_id,
    })
  }

  return {
    nodes: comfyNodes,
    edges,
    modelSlots,
    workflowName: ((data as any)?.extra?.workspace?.name ?? 'ComfyUI 工作流') as string,
    format: 'ui_export',
    totalNodes: comfyNodes.length,
  }
}

/** 解析 ComfyUI API 格式 (workflow_api.json) */
function parseAPIFormat(data: Record<string, unknown>): ParsedWorkflow {
  const entries = Object.entries(data).filter(([k]) => /^\d+$/.test(k))

  const comfyNodes: ComfyNode[] = []
  const modelSlots: ModelSlot[] = []
  let idx = 0

  for (const [rawIdStr, val] of entries) {
    const rawId = parseInt(rawIdStr, 10)
    const apiNode = val as RawAPINode
    const classType = apiNode.class_type
    const id = `comfy_${rawId}`
    const { isModelSlot, slotType, category } = detectModelSlot(classType)

    // 自动布局: 网格排列
    const col = idx % 4
    const row = Math.floor(idx / 4)
    const position = { x: 50 + col * 320, y: 80 + row * 220 }

    // 从 inputs 提取 widgets_values 和连接关系
    const widgetValues: Record<string, unknown> = {}
    const inputs: Array<{ name: string; type: string; linked: boolean }> = []

    for (const [key, value] of Object.entries(apiNode.inputs)) {
      if (Array.isArray(value)) {
        // [node_id, slot_index] — 这是一个连接引用
        inputs.push({ name: key, type: '*', linked: true })
      } else {
        // 字面量参数
        widgetValues[key] = value
        inputs.push({ name: key, type: inferWidgetType(key, value), linked: false })
      }
    }

    // 推断输出类型
    const outputs = getOutputTypesForClass(classType)

    const node: ComfyNode = {
      rawId,
      id,
      classType,
      position,
      widgetValues,
      inputs,
      outputs,
      isModelSlot,
      modelSlotType: slotType,
      category,
    }
    comfyNodes.push(node)

    if (isModelSlot && slotType) {
      modelSlots.push({
        nodeId: id,
        nodeLabel: `${classType} #${rawId}`,
        nodeClassType: classType,
        slotType,
        currentValue: (widgetValues.ckpt_name ?? widgetValues.unet_name ?? widgetValues.lora_name ?? '') as string,
        availableModels: getMockModels(slotType),
        extraParams: slotType === 'lora' ? { strength_model: apiNode.inputs.strength_model ?? 0.8, strength_clip: apiNode.inputs.strength_clip ?? 0.8 } : undefined,
      })
    }

    idx++
  }

  // API format 没有显式连线，从 inputs 中的 [id, slot] 引用构建
  const edges: ComfyEdge[] = []
  const idToRFId = new Map(comfyNodes.map((n) => [n.rawId, n.id]))
  let edgeIdx = 0

  for (const [, val] of entries) {
    const apiNode = val as RawAPINode
    // srcRFId unused — API format edges built from input refs below

    for (const [key, v] of Object.entries(apiNode.inputs)) {
      if (Array.isArray(v)) {
        const [srcRawId] = v as [number, number]
        const tgtRawId = parseInt(Object.entries(data).find(([, node]) => node === apiNode)?.[0] ?? '-1', 10)
        const srcId = idToRFId.get(srcRawId)
        const tgtId = idToRFId.get(tgtRawId)
        if (srcId && tgtId) {
          edges.push({
            id: `ce_api_${edgeIdx++}`,
            source: srcId,
            target: tgtId,
            sourceHandle: `out_*`,
            targetHandle: `in_${key}`,
            sourceRawId: srcRawId,
            targetRawId: tgtRawId,
          })
        }
      }
    }
  }

  return {
    nodes: comfyNodes,
    edges,
    modelSlots,
    workflowName: 'ComfyUI 工作流',
    format: 'api_format',
    totalNodes: comfyNodes.length,
  }
}

// ---- 辅助函数 ----

/** 根据 class_type 返回标准输入名列表 (对应 widgets_values 索引) */
function getInputNamesForClass(classType: string): string[] {
  const map: Record<string, string[]> = {
    CheckpointLoaderSimple: ['ckpt_name'],
    CheckpointLoader: ['ckpt_name', 'config_name'],
    UNETLoader: ['unet_name', 'weight_dtype'],
    CLIPLoader: ['clip_name', 'type'],
    DualCLIPLoader: ['clip_name1', 'clip_name2', 'type'],
    LoraLoader: ['lora_name', 'strength_model', 'strength_clip', 'model', 'clip'],
    VAELoader: ['vae_name'],
    KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'model', 'positive', 'negative', 'latent_image'],
    KSamplerAdvanced: ['add_noise', 'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise', 'model', 'positive', 'negative', 'samples'],
    CLIPTextEncode: ['text', 'clip'],
    EmptyLatentImage: ['width', 'height', 'batch_size'],
    VAEDecode: ['samples', 'vae'],
    SaveImage: ['filename_prefix', 'images'],
    PreviewImage: ['images'],
    ControlNetApply: ['conditioning', 'control_net', 'image', 'strength'],
    ImageScale: ['upscale_method', 'width', 'height', 'crop', 'image'],
    LatentUpscale: ['upscale_method', 'width', 'height', 'batch_size', 'samples'],
  }
  return map[classType] ?? Object.keys({})
}

/** 根据 class_type 推断输出类型 */
function getOutputTypesForClass(classType: string): Array<{ name: string; type: string }> {
  const map: Record<string, Array<{ name: string; type: string }>> = {
    CheckpointLoaderSimple: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }, { name: 'VAE', type: 'VAE' }],
    UNETLoader: [{ name: 'MODEL', type: 'MODEL' }],
    CLIPLoader: [{ name: 'CLIP', type: 'CLIP' }],
    LoraLoader: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }],
    VAELoader: [{ name: 'VAE', type: 'VAE' }],
    KSampler: [{ name: 'LATENT', type: 'LATENT' }],
    CLIPTextEncode: [{ name: 'CONDITIONING', type: 'CONDITIONING' }],
    EmptyLatentImage: [{ name: 'LATENT', type: 'LATENT' }],
    VAEDecode: [{ name: 'IMAGE', type: 'IMAGE' }],
    SaveImage: [],
    PreviewImage: [{ name: 'IMAGE', type: 'IMAGE' }],
  }
  return map[classType] ?? [{ name: 'output', type: '*' }]
}

/** 推断 widget 值的类型 */
function inferWidgetType(key: string, value: unknown): string {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (key.includes('ckpt') || key.includes('model') || key.includes('lora') || key.includes('vae') || key.includes('clip')) return 'model'
  return 'string'
}

/** Mock 模型列表 (TODO: 后端 GET /api/v1/comfy/models 替换) */
function getMockModels(slotType: ModelSlotType): string[] {
  const mockDB: Record<ModelSlotType, string[]> = {
    checkpoint: [
      'sd_xl_base_1.0.safetensors',
      'sd_xl_refiner_1.0.safetensors',
      'realisticVisionV51_v51VAE.safetensors',
      'juggernautXL_version9Rundiffusionphoto.safetensors',
      'dreamshaperXL_09.safetensors',
      'taiXLEmbeddings.safetensors',
    ],
    unet: ['sd_xl_base_1.0_unet/diffusion_model.safetensors', 'juggernautXL_unet.safetensors'],
    clip: ['sd_xl_base_1.0/text_encoder/model.safetensors', 't5xxl_fp16.safetensors'],
    lora: [
      'detail_tweaker_xl.safetensors',
      'add_detail.safetensors',
      'epi_noiseoffset2.safetensors',
    ],
    vae: ['sdxl_vae.safetensors', 'vae-ft-mse-840000-ema-pruned.safetensors'],
    sampler: [],
    controlnet: [
      'control_v11p_sd15_canny.safetensors',
      'control_v11f1p_sd15_depth.safetensors',
      'control_v11p_sd15_openpose.safetensors',
    ],
  }
  return mockDB[slotType] ?? []
}

// ---- 转换为 ReactFlow 格式 ----

/** 将 ComfyNode[] + ComfyEdge[] 转换为 ReactFlow Node[] + Edge[] */
export function toReactFlow(parsed: ParsedWorkflow): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = parsed.nodes.map((cn) => ({
    id: cn.id,
    type: 'comfyui',
    position: cn.position,
    data: {
      classType: cn.classType,
      widgetValues: cn.widgetValues,
      inputs: cn.inputs,
      outputs: cn.outputs,
      isModelSlot: cn.isModelSlot,
      modelSlotType: cn.modelSlotType,
      category: cn.category,
      rawId: cn.rawId,
    },
  }))

  const edges: Edge[] = parsed.edges.map((ce) => ({
    id: ce.id,
    source: ce.source,
    target: ce.target,
    sourceHandle: ce.sourceHandle,
    targetHandle: ce.targetHandle,
    type: 'smoothstep',
    style: { stroke: '#555', strokeWidth: 1.5 },
  }))

  return { nodes, edges }
}
