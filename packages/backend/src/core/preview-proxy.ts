import path from 'path'
// packages/backend/src/core/preview-proxy.ts · 2026-06-20
// 预览代理 — 将 ima 知识库内容转为前端 PreviewTab 可消费格式

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const PYTHON = 'python3'
interface PreviewRequest {
  type: 'ima_kb_item' | 'ima_note'
  mediaId?: string
  noteId?: string
}

interface PreviewResponse {
  type: 'text' | 'markdown' | 'code' | 'json' | 'image'
  title: string
  content: string
  source: string
}

export async function resolvePreview(req: PreviewRequest): Promise<PreviewResponse | null> {
  try {
    if (req.type === 'ima_kb_item' && req.mediaId) {
      // 调用 Python ima_api 获取 media info
      const script = `
from deerflow.ima_api import get_media_info, get_doc_content
import json, sys

info = get_media_info('${req.mediaId}')
if info.get('code') != 0:
    print(json.dumps({'error': info.get('msg', 'unknown')}))
    sys.exit(0)

data = info.get('data', {})
title = data.get('title', '未命名')
notebook_id = data.get('notebook_ext_info', {}).get('notebook_id', '')

if notebook_id:
    doc = get_doc_content(notebook_id)
    if doc.get('code') == 0:
        content = doc.get('data', {}).get('content', '')
        result = {'type': 'markdown', 'title': title, 'content': content, 'source': 'ima知识库'}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

result = {'type': 'text', 'title': title, 'content': json.dumps(data, ensure_ascii=False, indent=2), 'source': 'ima知识库'}
print(json.dumps(result, ensure_ascii=False))
`
      const { stdout } = await execFileP(PYTHON, ['-c', script], {
        cwd: path.resolve(process.cwd(), '../../'),
        timeout: 15000,
      })
      return JSON.parse(stdout.trim())
    }

    if (req.type === 'ima_note' && req.noteId) {
      const script = `
from deerflow.ima_api import get_doc_content
import json, sys

doc = get_doc_content('${req.noteId}')
if doc.get('code') != 0:
    print(json.dumps({'error': doc.get('msg', 'unknown')}))
    sys.exit(0)

content = doc.get('data', {}).get('content', '')
title = doc.get('data', {}).get('title', '笔记')
result = {'type': 'markdown', 'title': title, 'content': content, 'source': 'ima笔记'}
print(json.dumps(result, ensure_ascii=False))
`
      const { stdout } = await execFileP(PYTHON, ['-c', script], {
        cwd: path.resolve(process.cwd(), '../../'),
        timeout: 15000,
      })
      return JSON.parse(stdout.trim())
    }

    return null
  } catch (e) {
    console.error('[preview-proxy] error:', e)
    return null
  }
}
