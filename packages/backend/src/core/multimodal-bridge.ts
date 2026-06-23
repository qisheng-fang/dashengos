// packages/backend/src/core/multimodal-bridge.ts · DaShengOS v6.0
// 多模态桥接 — 视觉/音频/视频 统一接入层
// 2026-06-23

import { existsSync, readFileSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type ModalityType = 'image' | 'audio' | 'video' | 'text'

export interface MultimodalInput {
  type: ModalityType
  data: string           // base64 encoded or file path
  mimeType: string       // e.g. image/png, audio/wav, video/mp4
  metadata?: {
    width?: number
    height?: number
    duration?: number    // seconds, for audio/video
    channels?: number
    sampleRate?: number
  }
}

export interface MultimodalMessage {
  role: 'user' | 'assistant'
  content: Array<{
    type: 'text' | 'image_url' | 'audio_url' | 'video_url'
    text?: string
    image_url?: { url: string; detail?: 'low' | 'high' | 'auto' }
    audio_url?: { url: string }
    video_url?: { url: string }
  }>
}

export interface MultimodalCapability {
  vision: boolean
  audio: boolean
  video: boolean
  maxImageSize: number       // bytes
  maxAudioDuration: number   // seconds
  supportedFormats: {
    images: string[]
    audio: string[]
    video: string[]
  }
}

// ═══════════════════════════════════════════════════════════
// 能力检测 (基于当前 provider)
// ═══════════════════════════════════════════════════════════

export function getMultimodalCapability(providerName: string): MultimodalCapability {
  // Google Gemini — 全模态
  if (providerName === 'google') {
    return {
      vision: true, audio: true, video: true,
      maxImageSize: 20 * 1024 * 1024,
      maxAudioDuration: 5400,
      supportedFormats: {
        images: ['png', 'jpeg', 'jpg', 'webp', 'gif'],
        audio: ['wav', 'mp3', 'ogg', 'flac'],
        video: ['mp4', 'webm', 'mov'],
      },
    }
  }
  
  // DeepSeek — 纯文本 (当前不支持视觉)
  if (providerName === 'deepseek') {
    return {
      vision: false, audio: false, video: false,
      maxImageSize: 0, maxAudioDuration: 0,
      supportedFormats: { images: [], audio: [], video: [] },
    }
  }
  
  // Qwen (SiliconFlow) — 视觉
  if (providerName === 'siliconflow') {
    return {
      vision: true, audio: false, video: false,
      maxImageSize: 10 * 1024 * 1024,
      maxAudioDuration: 0,
      supportedFormats: {
        images: ['png', 'jpeg', 'jpg', 'webp'],
        audio: [], video: [],
      },
    }
  }
  
  // Agnes AI — 视觉+音频
  if (providerName === 'agnes_ai') {
    return {
      vision: true, audio: true, video: true,
      maxImageSize: 15 * 1024 * 1024,
      maxAudioDuration: 600,
      supportedFormats: {
        images: ['png', 'jpeg', 'jpg', 'webp'],
        audio: ['wav', 'mp3', 'ogg'],
        video: ['mp4', 'webm'],
      },
    }
  }
  
  // 默认: 无多模态
  return { vision: false, audio: false, video: false, maxImageSize: 0, maxAudioDuration: 0, supportedFormats: { images: [], audio: [], video: [] } }
}

// ═══════════════════════════════════════════════════════════
// 文件转 multimodal-ready 格式
// ═══════════════════════════════════════════════════════════

export function fileToMultimodalInput(filePath: string): MultimodalInput | null {
  if (!existsSync(filePath)) return null
  
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  }
  
  const mimeType = mimeMap[ext]
  if (!mimeType) return null
  
  const buffer = readFileSync(filePath)
  const type: ModalityType = mimeType.startsWith('image') ? 'image' : mimeType.startsWith('audio') ? 'audio' : 'video'
  
  return {
    type,
    data: buffer.toString('base64'),
    mimeType,
    metadata: { width: 0, height: 0 },
  }
}

/**
 * 构造 multimodal message (OpenAI/Gemini 格式)
 */
export function buildMultimodalMessage(
  textContent: string,
  inputs: MultimodalInput[],
  provider: string
): MultimodalMessage {
  const content: MultimodalMessage['content'] = [{ type: 'text', text: textContent }]
  
  for (const input of inputs) {
    const dataUrl = `data:${input.mimeType};base64,${input.data}`
    
    if (input.type === 'image') {
      content.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } })
    } else if (input.type === 'audio') {
      content.push({ type: 'audio_url', audio_url: { url: dataUrl } })
    } else if (input.type === 'video') {
      content.push({ type: 'video_url', video_url: { url: dataUrl } })
    }
  }
  
  return { role: 'user', content }
}

// ═══════════════════════════════════════════════════════════
// 智能路由: 根据内容类型自动选择 provider
// ═══════════════════════════════════════════════════════════

export function routeByModality(
  inputs: MultimodalInput[],
  availableProviders: string[]
): string | null {
  if (inputs.length === 0) return null
  
  const needs = {
    vision: inputs.some(i => i.type === 'image'),
    audio: inputs.some(i => i.type === 'audio'),
    video: inputs.some(i => i.type === 'video'),
  }
  
  // 优先级: Google (全模态) → Agnes AI → SiliconFlow (视觉) → DeepSeek (纯文本回退)
  for (const provider of availableProviders) {
    const cap = getMultimodalCapability(provider)
    if ((!needs.vision || cap.vision) &&
        (!needs.audio || cap.audio) &&
        (!needs.video || cap.video)) {
      return provider
    }
  }
  
  return null
}

console.log('[MultimodalBridge] 多模态桥接已就绪 (Vision/Audio/Video)')
