// packages/cli/src/config.ts · DaShengOS CLI 配置
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DASHENG_DIR = join(homedir(), '.dasheng')
export const TOKEN_FILE = join(DASHENG_DIR, 'token')
export const HISTORY_FILE = join(DASHENG_DIR, 'history')

export function getConfig() {
  return {
    backendUrl: process.env.DASHENG_BACKEND || 'http://127.0.0.1:8000',
    model: process.env.DASHENG_MODEL || '',
    username: process.env.DASHENG_USER || 'admin',
  }
}
