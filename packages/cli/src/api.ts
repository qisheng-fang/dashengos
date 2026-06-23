// packages/cli/src/api.ts · DaShengOS CLI API 客户端
import { getValidToken } from './auth.js'
import { getConfig } from './config.js'

export async function apiGet(path: string): Promise<any> {
  const cfg = getConfig()
  const token = await getValidToken()
  const resp = await fetch(`${cfg.backendUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
  return resp.json()
}

export async function apiPost(path: string, body?: Record<string, unknown>): Promise<any> {
  const cfg = getConfig()
  const token = await getValidToken()
  const resp = await fetch(`${cfg.backendUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
  return resp.json()
}

export async function apiPut(path: string, body?: Record<string, unknown>): Promise<any> {
  const cfg = getConfig()
  const token = await getValidToken()
  const resp = await fetch(`${cfg.backendUrl}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
  return resp.json()
}

export async function apiDelete(path: string): Promise<any> {
  const cfg = getConfig()
  const token = await getValidToken()
  const resp = await fetch(`${cfg.backendUrl}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
  return resp.json()
}

/** 无需鉴权的公开 GET */
export async function apiPublicGet(path: string): Promise<any> {
  const cfg = getConfig()
  const resp = await fetch(`${cfg.backendUrl}${path}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}
