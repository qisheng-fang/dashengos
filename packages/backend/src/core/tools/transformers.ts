// packages/backend/src/core/tools/transformers.ts
// DaShengOS v6.0 — Transformers 工具模块
// JS: @xenova/transformers (本地推理) + Python: transformers bridge

import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// ─── Types ───────────────────────────────────────────────

export interface TransformersToolDef {
  name: string
  description: string
  parameters: Record<string, any>
  riskLevel: 'READ' | 'WRITE' | 'NETWORK' | 'EXEC'
  category: 'nlp' | 'vision' | 'audio' | 'multimodal'
}

export interface TransformersResult {
  success: boolean
  data?: string
  error?: string
  model?: string
  latencyMs?: number
}

// ─── Available Tools ──────────────────────────────────────

export const TRANSFORMERS_TOOLS: TransformersToolDef[] = [
  // ── NLP ──
  {
    name: 'transformers_sentiment',
    description: '情感分析：分析文本的情感倾向（正面/负面/中性）',
    parameters: { text: { type: 'string', description: '待分析的文本' } },
    riskLevel: 'READ', category: 'nlp'
  },
  {
    name: 'transformers_summarize',
    description: '文本摘要：将长文本压缩为简洁摘要',
    parameters: { text: { type: 'string', description: '待摘要的长文本' }, max_length: { type: 'number', description: '最大输出长度', default: 150 } },
    riskLevel: 'READ', category: 'nlp'
  },
  {
    name: 'transformers_translate',
    description: '翻译：将文本翻译为目标语言（中英互译）',
    parameters: { text: { type: 'string', description: '待翻译文本' }, target_lang: { type: 'string', description: '目标语言 zh/en', default: 'zh' } },
    riskLevel: 'READ', category: 'nlp'
  },
  {
    name: 'transformers_ner',
    description: '命名实体识别：提取人名/地名/组织名等',
    parameters: { text: { type: 'string', description: '待分析的文本' } },
    riskLevel: 'READ', category: 'nlp'
  },
  {
    name: 'transformers_embed',
    description: '文本向量化：将文本转为向量嵌入',
    parameters: { text: { type: 'string', description: '待向量化的文本' } },
    riskLevel: 'READ', category: 'nlp'
  },
  // ── Vision ──
  {
    name: 'transformers_classify_image',
    description: '图像分类：识别图片中的物体',
    parameters: { image_path: { type: 'string', description: '图片文件路径' } },
    riskLevel: 'READ', category: 'vision'
  },
  {
    name: 'transformers_ocr',
    description: 'OCR 文字识别：从图片中提取文字',
    parameters: { image_path: { type: 'string', description: '图片文件路径' } },
    riskLevel: 'READ', category: 'vision'
  },
  // ── Audio ──
  {
    name: 'transformers_transcribe',
    description: '语音转文字：将音频转录为文本 (Whisper)',
    parameters: { audio_path: { type: 'string', description: '音频文件路径' } },
    riskLevel: 'READ', category: 'audio'
  },
]

// ─── Python Bridge ────────────────────────────────────────

function pythonTransformers(script: string, args: Record<string, any>): TransformersResult {
  const t0 = Date.now()
  try {
    const tmpDir = '/tmp/dasheng-transformers'
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
    const scriptPath = `${tmpDir}/script_${randomUUID()}.py`
    const argsPath = `${tmpDir}/args_${randomUUID()}.json`
    
    writeFileSync(scriptPath, script)
    writeFileSync(argsPath, JSON.stringify(args))
    
    const cmd = `python3 ${scriptPath} ${argsPath} 2>&1`
    const output = execSync(cmd, { 
      encoding: 'utf-8', 
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024 
    })
    try { unlinkSync(scriptPath); unlinkSync(argsPath) } catch {}
    return { success: true, data: output.trim(), latencyMs: Date.now() - t0 }
  } catch (e: any) {
    return { success: false, error: e.stderr?.slice(0, 500) || e.message?.slice(0, 300), latencyMs: Date.now() - t0 }
  }
}

// ─── JS Transformers (if @xenova/transformers is installed) ──

let xenovaPipeline: any = null
async function getXenovaPipeline(): Promise<any> {
  if (xenovaPipeline) return xenovaPipeline
  try {
    const mod = await import('@xenova/transformers')
    xenovaPipeline = mod.pipeline
    return xenovaPipeline
  } catch {
    return null
  }
}

// ─── Executor ─────────────────────────────────────────────

export async function executeTransformersTool(
  toolName: string,
  args: Record<string, any>
): Promise<TransformersResult> {
  const t0 = Date.now()

  // Try JS transformers first
  const pipeline = await getXenovaPipeline()
  
  switch (toolName) {
    case 'transformers_sentiment': {
      const text = args.text || ''
      if (!text) return { success: false, error: '缺少 text 参数' }
      
      if (pipeline) {
        try {
          const classifier = await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english')
          const result = await classifier(text)
          return { success: true, data: JSON.stringify(result), model: 'distilbert-sst2', latencyMs: Date.now() - t0 }
        } catch (e: any) {
          // fallback to Python
        }
      }
      
      // Python fallback
      return pythonTransformers(`
from transformers import pipeline
with open(sys.argv[1]) as f: args = json.load(f)
classifier = pipeline("sentiment-analysis", model="distilbert-base-uncased-finetuned-sst-2-english")
result = classifier(args["text"])
print(json.dumps(result, ensure_ascii=False))
`, { text })
    }

    case 'transformers_summarize': {
      const text = args.text || ''
      if (!text) return { success: false, error: '缺少 text 参数' }
      
      if (pipeline) {
        try {
          const summarizer = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6')
          const result = await summarizer(text, { max_length: args.max_length || 150 })
          return { success: true, data: JSON.stringify(result), model: 'distilbart-cnn', latencyMs: Date.now() - t0 }
        } catch { /* fallback */ }
      }
      
      return pythonTransformers(`
from transformers import pipeline
with open(sys.argv[1]) as f: args = json.load(f)
summarizer = pipeline("summarization", model="facebook/bart-large-cnn")
result = summarizer(args["text"], max_length=args.get("max_length", 150), min_length=30, do_sample=False)
print(json.dumps(result, ensure_ascii=False))
`, { text, max_length: args.max_length || 150 })
    }

    case 'transformers_translate': {
      const text = args.text || ''
      const targetLang = args.target_lang || 'zh'
      if (!text) return { success: false, error: '缺少 text 参数' }
      
      return pythonTransformers(`
from transformers import pipeline
with open(sys.argv[1]) as f: args = json.load(f)
target = args.get("target_lang", "zh")
if target == "zh":
    translator = pipeline("translation", model="Helsinki-NLP/opus-mt-en-zh")
else:
    translator = pipeline("translation", model="Helsinki-NLP/opus-mt-zh-en")
result = translator(args["text"], max_length=400)
print(json.dumps(result, ensure_ascii=False))
`, { text, target_lang: targetLang })
    }

    case 'transformers_ner': {
      const text = args.text || ''
      if (!text) return { success: false, error: '缺少 text 参数' }
      
      return pythonTransformers(`
from transformers import pipeline
with open(sys.argv[1]) as f: args = json.load(f)
ner = pipeline("ner", model="dbmdz/bert-large-cased-finetuned-conll03-english", grouped_entities=True)
result = ner(args["text"])
print(json.dumps(result, ensure_ascii=False))
`, { text })
    }

    case 'transformers_embed': {
      const text = args.text || ''
      if (!text) return { success: false, error: '缺少 text 参数' }
      
      if (pipeline) {
        try {
          const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
          const result = await extractor(text, { pooling: 'mean', normalize: true })
          return { success: true, data: JSON.stringify({ embedding: Array.from(result.data).slice(0, 10), dims: result.dims }), model: 'all-MiniLM-L6-v2', latencyMs: Date.now() - t0 }
        } catch { /* fallback */ }
      }
      
      return pythonTransformers(`
from transformers import pipeline
import torch
with open(sys.argv[1]) as f: args = json.load(f)
extractor = pipeline("feature-extraction", model="sentence-transformers/all-MiniLM-L6-v2")
result = extractor(args["text"], return_tensors="pt")
vec = result[0].mean(dim=0).tolist()
print(json.dumps({"embedding": vec[:10], "dims": len(vec), "note": "first 10 dims shown"}))
`, { text })
    }

    case 'transformers_classify_image': {
      const imagePath = args.image_path || ''
      if (!imagePath) return { success: false, error: '缺少 image_path 参数' }
      
      return pythonTransformers(`
from transformers import pipeline
import json, sys
with open(sys.argv[1]) as f: args = json.load(f)
classifier = pipeline("image-classification", model="google/vit-base-patch16-224")
result = classifier(args["image_path"])
print(json.dumps(result[:5], ensure_ascii=False))
`, { image_path: imagePath })
    }

    case 'transformers_ocr': {
      const imagePath = args.image_path || ''
      if (!imagePath) return { success: false, error: '缺少 image_path 参数' }
      
      return pythonTransformers(`
from transformers import pipeline
import json, sys
with open(sys.argv[1]) as f: args = json.load(f)
ocr = pipeline("image-to-text", model="microsoft/trocr-base-handwritten")
result = ocr(args["image_path"])
print(json.dumps(result, ensure_ascii=False))
`, { image_path: imagePath })
    }

    case 'transformers_transcribe': {
      const audioPath = args.audio_path || ''
      if (!audioPath) return { success: false, error: '缺少 audio_path 参数' }
      
      return pythonTransformers(`
from transformers import pipeline
import json, sys
with open(sys.argv[1]) as f: args = json.load(f)
transcriber = pipeline("automatic-speech-recognition", model="openai/whisper-tiny")
result = transcriber(args["audio_path"])
print(json.dumps(result, ensure_ascii=False))
`, { audio_path: audioPath })
    }

    default:
      return { success: false, error: `未知工具: ${toolName}` }
  }
}

// ─── Tool listing for LLM ─────────────────────────────────

export function getTransformersToolsForLLM() {
  return TRANSFORMERS_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: `[Transformers/${t.category}] ${t.description}`,
      parameters: {
        type: 'object',
        properties: t.parameters,
        required: Object.keys(t.parameters).filter(k => !('default' in (t.parameters[k] || {}))),
      },
    },
  }))
}
