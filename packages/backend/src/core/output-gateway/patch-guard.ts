// Patch Guard — 文件写入保护
import type { FilteredOutput } from './types.js'

const PROTECTED_PATHS = [
  /\.env$/,
  /\.codex-protect/,
  /\/\.git\/config$/,
  /\/\.ssh\//,
  /\/\.aws\//,
  /\/etc\//,
  /\/System\//,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
]

export function validatePatch(path: string, content: string, workspaceDir: string): FilteredOutput {
  // Check protected paths
  for (const pattern of PROTECTED_PATHS) {
    if (pattern.test(path)) {
      return {
        status: "deny",
        risk: "high",
        outputType: "patch",
        denyReason: `Protected file: ${path} matches ${pattern}`,
      }
    }
  }

  // Check if path is outside workspace
  const resolved = path.startsWith("/") ? path : `${workspaceDir}/${path}`
  if (!resolved.startsWith(workspaceDir)) {
    return {
      status: "deny",
      risk: "high",
      outputType: "patch",
      denyReason: `Path outside workspace: ${path}`,
    }
  }

  // Check for secrets in content
  const hasSecret = /(?:sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9_\-\.]{20,}|-----BEGIN.*PRIVATE KEY-----)/s.test(content)
  if (hasSecret) {
    return {
      status: "deny",
      risk: "high",
      outputType: "patch",
      denyReason: "Content contains secret/credential — write blocked",
    }
  }

  return { status: "allow", risk: "low", outputType: "patch", safeContent: { path, content } }
}
