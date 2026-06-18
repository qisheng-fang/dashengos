// packages/backend/src/api/documents.ts · Phase A.4 (2026-06-17)
// 文档生成 REST API
// 前缀: /api/v1/documents
//
// 端点:
//   POST /generate     — 生成文档 (支持 AI 辅助)
//   GET  /download/:name — 下载已生成的文档
//   GET  /formats      — 列出支持的格式和能力

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  generatePPTX,
  generateDOCX,
  generatePDF,
  generateXLSX,
  checkPythonDeps,
} from '../core/document-generator.js'
import fs from 'fs/promises'
import path from 'path'

// ─── Zod Schemas ─────────────────────────────────────────

const GenerateBody = z.object({
  format: z.enum(['pptx', 'docx', 'pdf', 'xlsx']),
  topic: z.string().max(500).optional(),
  // Direct content (skip AI generation)
  content: z
    .object({
      // PPTX
      slides: z
        .array(
          z.object({
            title: z.string().max(200),
            content: z.string().max(10000),
          }),
        )
        .max(50)
        .optional(),
      // DOCX
      sections: z
        .array(
          z.object({
            heading: z.string().max(200),
            content: z.string().max(10000),
          }),
        )
        .max(50)
        .optional(),
      // PDF
      html: z.string().max(100000).optional(),
      // XLSX
      sheets: z
        .array(
          z.object({
            name: z.string().max(31),
            headers: z.array(z.string().max(100)).max(50),
            rows: z.array(z.array(z.string().max(500))).max(1000),
          }),
        )
        .max(20)
        .optional(),
      // Common
      title: z.string().max(300).optional(),
    })
    .optional(),
})

// ─── LLM Helper ──────────────────────────────────────────

const LLM_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1'
const LLM_API_KEY = process.env.SILICONFLOW_API_KEY || ''
const LLM_MODEL = process.env.SILICONFLOW_DEFAULT_MODEL || 'Qwen/Qwen2.5-72B-Instruct'

async function callLLM(prompt: string): Promise<string> {
  if (!LLM_API_KEY) {
    throw new Error('未配置 SILICONFLOW_API_KEY，无法使用 AI 生成内容')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)

  try {
    const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 3072,
        temperature: 0.7,
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`LLM error ${resp.status}: ${errText.slice(0, 200)}`)
    }

    const data = (await resp.json()) as {
      choices: [{ message: { content: string } }]
    }
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timer)
  }
}

// ─── AI Content Generation Prompts ───────────────────────

async function generatePPTXContent(topic: string): Promise<{ title: string; slides: Array<{ title: string; content: string }> }> {
  const prompt = `你是一位专业的演示文稿设计师。请以"${topic}"为主题，生成一份 PPT 演示文稿的结构化内容。

返回严格的 JSON 格式（不要任何其他文字，只返回 JSON）：
{
  "title": "演示文稿总标题",
  "slides": [
    { "title": "第1页标题", "content": "第1页内容（可以包含要点列表，每行一个要点）" },
    { "title": "第2页标题", "content": "第2页内容" },
    ...
  ]
}

要求：
- 标题简洁有力（不超过20字）
- 每页内容3-5个要点，用换行分隔
- 总共6-10页（包含封面和总结页）
- 内容专业、有深度`

  const text = await callLLM(prompt)
  // Extract JSON from response (in case LLM wraps it in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI 返回的内容无法解析为 JSON')
  const parsed = JSON.parse(jsonMatch[0])
  return { title: parsed.title, slides: parsed.slides }
}

async function generateDOCXContent(topic: string): Promise<{ title: string; sections: Array<{ heading: string; content: string }> }> {
  const prompt = `你是一位专业文档撰稿人。请以"${topic}"为主题，生成一份结构化文档内容。

返回严格的 JSON 格式（不要任何其他文字）：
{
  "title": "文档标题",
  "sections": [
    { "heading": "第一节标题", "content": "第一节正文内容（Markdown 格式，可以包含列表、段落）" },
    { "heading": "第二节标题", "content": "第二节正文内容" },
    ...
  ]
}

要求：
- 每节内容200-500字
- 3-6节，逻辑递进
- 内容专业、有深度、可操作`

  const text = await callLLM(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI 返回的内容无法解析为 JSON')
  const parsed = JSON.parse(jsonMatch[0])
  return { title: parsed.title, sections: parsed.sections }
}

async function generatePDFContent(topic: string): Promise<{ title: string; html: string }> {
  const prompt = `你是一位专业的技术文档撰写人。请以"${topic}"为主题，生成一个完整的 HTML 格式文档内容。

要求：
- 返回纯 HTML（不要 DOCTYPE, <html>, <head>, <body> 标签，只返回 body 内部内容）
- 使用语义化标签：h1 标题, h2 小节, h3 子小节, p 段落, ul/ol 列表, table 表格
- 内容深度覆盖：背景、现状、方法、案例、结论
- 总字数1500-3000字
- 适合打印成 PDF 阅读`

  const html = await callLLM(prompt)
  // Strip any markdown code fences
  const cleaned = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
  return { title: topic, html: cleaned }
}

async function generateXLSXContent(topic: string): Promise<{ sheets: Array<{ name: string; headers: string[]; rows: string[][] }> }> {
  const prompt = `你是一位专业数据分析师。请以"${topic}"为主题，生成一个表格/电子表格的结构化数据。

返回严格的 JSON 格式：
{
  "sheets": [
    {
      "name": "工作表名称",
      "headers": ["列1标题", "列2标题", "列3标题", ...],
      "rows": [
        ["行1值1", "行1值2", "行1值3", ...],
        ["行2值1", "行2值2", "行2值3", ...],
        ...
      ]
    }
  ]
}

要求：
- 1-3个工作表
- 每个表5-20行数据
- 列数3-8列
- 数据合理、有参考价值
- 表头名称清晰易懂`

  const text = await callLLM(prompt)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI 返回的内容无法解析为 JSON')
  const parsed = JSON.parse(jsonMatch[0])
  return { sheets: parsed.sheets }
}

// ─── Routes ──────────────────────────────────────────────

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /generate ──────────────────────────────────────
  app.post('/generate', async (req, reply) => {
    const parsed = GenerateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不正确',
        details: parsed.error.issues,
      })
    }

    const { format, topic, content } = parsed.data

    try {
      let result: { filePath: string; fileName: string; size: number }

      switch (format) {
        case 'pptx': {
          let title = content?.title || topic || 'Untitled'
          let slides = content?.slides || []

          // AI generation if no content provided
          if (!content?.slides && topic) {
            const aiContent = await generatePPTXContent(topic)
            title = aiContent.title
            slides = aiContent.slides
          }

          if (slides.length === 0) {
            return reply.status(400).send({
              code: 'EMPTY_CONTENT',
              message: '请提供 slides 内容或指定 topic 让 AI 生成',
            })
          }

          result = await generatePPTX({ title, slides })
          break
        }

        case 'docx': {
          let title = content?.title || topic || 'Untitled'
          let sections = content?.sections || []

          if (!content?.sections && topic) {
            const aiContent = await generateDOCXContent(topic)
            title = aiContent.title
            sections = aiContent.sections
          }

          if (sections.length === 0) {
            return reply.status(400).send({
              code: 'EMPTY_CONTENT',
              message: '请提供 sections 内容或指定 topic 让 AI 生成',
            })
          }

          result = await generateDOCX({ title, sections })
          break
        }

        case 'pdf': {
          let title = content?.title || topic || 'Untitled'
          let html = content?.html || ''

          if (!content?.html && topic) {
            const aiContent = await generatePDFContent(topic)
            title = aiContent.title
            html = aiContent.html
          }

          if (!html) {
            return reply.status(400).send({
              code: 'EMPTY_CONTENT',
              message: '请提供 html 内容或指定 topic 让 AI 生成',
            })
          }

          result = await generatePDF({ title, html })
          break
        }

        case 'xlsx': {
          let sheets = content?.sheets || []

          if (!content?.sheets && topic) {
            const aiContent = await generateXLSXContent(topic)
            sheets = aiContent.sheets
          }

          if (sheets.length === 0) {
            return reply.status(400).send({
              code: 'EMPTY_CONTENT',
              message: '请提供 sheets 内容或指定 topic 让 AI 生成',
            })
          }

          result = await generateXLSX({ sheets })
          break
        }

        default:
          return reply.status(400).send({
            code: 'UNSUPPORTED_FORMAT',
            message: `不支持的格式: ${format}`,
          })
      }

      return reply.send({
        ok: true,
        file_path: result.filePath,
        file_name: result.fileName,
        size: result.size,
        format,
      })
    } catch (err) {
      const message = (err as Error).message

      // Missing Python packages
      if (message.includes('No module named') || message.includes('未安装')) {
        const pkg = message.includes('pptx') ? 'python-pptx'
          : message.includes('docx') ? 'python-docx'
          : message.includes('weasyprint') ? 'weasyprint'
          : message.includes('openpyxl') ? 'openpyxl'
          : 'required package'

        return reply.status(500).send({
          code: 'MISSING_DEPENDENCY',
          message: `${pkg} 未安装。请运行: pip install ${pkg}`,
          install_command: `pip install ${pkg}`,
        })
      }

      // Python executable not found
      if (message.includes('Failed to spawn Python')) {
        return reply.status(500).send({
          code: 'PYTHON_UNAVAILABLE',
          message: 'Python 不可用。请确保已安装 Python 3.8+',
        })
      }

      // LLM key not configured
      if (message.includes('未配置 SILICONFLOW_API_KEY')) {
        return reply.status(400).send({
          code: 'LLM_KEY_MISSING',
          message: 'AI 内容生成需要配置 SILICONFLOW_API_KEY 环境变量',
        })
      }

      req.log.error({ err: message }, 'document generation failed')
      return reply.status(500).send({
        code: 'GENERATION_FAILED',
        message: '文档生成失败',
        detail: message.slice(0, 300),
      })
    }
  })

  // ── GET /download/:fileName ─────────────────────────────
  app.get('/download/:fileName', async (req, reply) => {
    const { fileName } = req.params as { fileName: string }

    // Strictly sanitize: only allow doc_ prefix with hex and standard extensions
    if (!/^doc_[a-f0-9]{10}\.(pptx|docx|pdf|xlsx)$/.test(fileName)) {
      return reply.status(400).send({
        code: 'INVALID_FILENAME',
        message: '无效的文件名',
      })
    }

    const filePath = path.join('/tmp/dasheng-docs', fileName)

    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: '文件不存在' })
      }

      const content = await fs.readFile(filePath)

      const mimeTypes: Record<string, string> = {
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pdf: 'application/pdf',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }

      const ext = fileName.split('.').pop() || ''
      const contentType = mimeTypes[ext] || 'application/octet-stream'

      reply.header('Content-Type', contentType)
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
      reply.header('Content-Length', stat.size)
      return reply.send(content)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ code: 'NOT_FOUND', message: '文件不存在或已过期' })
      }
      req.log.error({ err: (err as Error).message }, 'file download failed')
      return reply.status(500).send({ code: 'DOWNLOAD_FAILED', message: '文件下载失败' })
    }
  })

  // ── GET /formats ────────────────────────────────────────
  app.get('/formats', async (_req, reply) => {
    let deps: { python: string; packages: Record<string, boolean> } | null = null
    try {
      deps = await checkPythonDeps()
    } catch {
      deps = { python: 'unknown', packages: { pptx: false, docx: false, pdf: false, xlsx: false } }
    }

    return reply.send({
      formats: [
        {
          id: 'pptx',
          name: 'PowerPoint 演示文稿',
          extension: '.pptx',
          mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          ai_supported: true,
          available: deps?.packages?.pptx ?? false,
        },
        {
          id: 'docx',
          name: 'Word 文档',
          extension: '.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ai_supported: true,
          available: deps?.packages?.docx ?? false,
        },
        {
          id: 'pdf',
          name: 'PDF 文档',
          extension: '.pdf',
          mime_type: 'application/pdf',
          ai_supported: true,
          available: deps?.packages?.pdf ?? false,
        },
        {
          id: 'xlsx',
          name: 'Excel 电子表格',
          extension: '.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ai_supported: true,
          available: deps?.packages?.xlsx ?? false,
        },
      ],
      python: deps?.python ?? 'unknown',
    })
  })
}
