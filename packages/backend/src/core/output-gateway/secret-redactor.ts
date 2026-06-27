// Secret Redactor — 脱敏引擎
// v2.2: 仅脱敏明确的敏感路径，普通文件路径放行

const WORKSPACE_ROOT = process.env.WORKSPACE_DIR || '/Users/apple/Desktop/ai-workbench-v2'

const SECRET_PATTERNS = [
  { type: "api_key", pattern: /(?:sk|api[_-]?key|apikey)[=:]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/gi },
  { type: "token", pattern: /(?:Bearer\s+)([A-Za-z0-9_\-\.]{20,})/gi },
  { type: "jwt", pattern: /(?:eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/g },
  { type: "private_key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END/gi },
  // v2.2: 仅匹配明确的敏感路径（.env, .ssh, credentials, tokens 等）
  { type: "sensitive_path", pattern: /(?:\/Users\/\w+|\/home\/\w+)\/(?:\.(?:env|ssh|aws|gcloud|config|kube|cache|npm|docker)|[^\s\/]*?(?:secret|token|credential|password|private[_-]?key)[^\s\/]*?)(?:\/[^\s'"]*)?/gi },
]

export interface Redaction {
  type: string
  location: string
  replacement: string
}

interface RedactionResult {
  content: string
  redactions: Redaction[]
}

function isWorkspacePath(match: string): boolean {
  return match.startsWith(WORKSPACE_ROOT)
}

function isSensitivePath(match: string): boolean {
  // 总是保留工作区路径
  if (isWorkspacePath(match)) return false
  // 保留常见的非敏感目录
  const safeDirs = ['/Desktop/', '/Documents/', '/Downloads/', '/Projects/', '/Public/', '/tmp/dasheng']
  if (safeDirs.some(d => match.includes(d))) return false
  return true
}

export function redactSecrets(text: string): RedactionResult {
  let content = text
  const redactions: Redaction[] = []

  for (const { type, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const original = match[1] || match[0]
      // 工作区路径 + 安全目录 → 跳过
      if (type === 'sensitive_path' && !isSensitivePath(original)) {
        continue
      }
      const replacement = "*".repeat(Math.min(original.length, 12))
      content = content.replace(original, replacement)
      redactions.push({ type, location: `offset:${match.index}`, replacement })
    }
  }

  return { content, redactions }
}

export function redactObject(obj: unknown): { cleaned: unknown; redactions: Redaction[] } {
  if (typeof obj === 'string') {
    const result = redactSecrets(obj)
    return { cleaned: result.content, redactions: result.redactions }
  }
  if (Array.isArray(obj)) {
    const cleaned: unknown[] = []
    const allRedactions: Redaction[] = []
    for (const item of obj) {
      const r = redactObject(item)
      allRedactions.push(...r.redactions)
      cleaned.push(r.cleaned)
    }
    return { cleaned, redactions: allRedactions }
  }
  if (obj && typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {}
    const allRedactions: Redaction[] = []
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const r = redactObject(value)
      allRedactions.push(...r.redactions)
      cleaned[key] = r.cleaned
    }
    return { cleaned, redactions: allRedactions }
  }
  return { cleaned: obj, redactions: [] }
}

export function redactCommandOutput(stdout: string, stderr?: string): { stdout: string; stderr: string; redactions: Redaction[] } {
  const outResult = redactSecrets(stdout)
  const errResult = stderr ? redactSecrets(stderr) : { content: "", redactions: [] }
  return {
    stdout: outResult.content,
    stderr: errResult.content,
    redactions: [...outResult.redactions, ...errResult.redactions],
  }
}
