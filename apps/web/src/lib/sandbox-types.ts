// apps/web/src/lib/sandbox-types.ts · v0.3 Phase 4
//
// TypeScript types matching the Go sandbox daemon IPC responses.

export interface ExecResult {
  exit_code: number
  stdout: string
  stderr: string
  duration_ms: number
  timed_out: boolean
  isolated: boolean
}

export interface ExecParams {
  command: string
  args?: string[]
  workdir?: string
  env?: string[]
  input?: string
  timeout_ms?: number
  memory_mb?: number
  cpu_percent?: number
}

export interface FileReadResult {
  path: string
  content: string
  size: number
  mtime: number
}

export interface FileWriteResult {
  path: string
  bytes_written: number
  mtime: number
}

export interface FileListResult {
  files: string[]
}

export interface ResearchRunResult {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
}

export interface ResearchStatusResult {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  error?: string
}

export interface AgentInfo {
  id: string
  name: string
  author: string
  description: string
  capabilities: string[]
  installed: boolean
}
