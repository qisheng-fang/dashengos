// @deprecated — zvec C++ 未编译完成，暂未使用。待 zvec 就绪后接入 vector-memory.ts
// 保留作为未来集成蓝图
// packages/backend/src/core/zvec-bridge.ts · DaShengOS v6.0
// zvec 智能桥接 — 自动检测 zvec Python 可用性，动态切换引擎
// 2026-06-23

let zvecModule: any = null
let zvecAvailable = false

// 尝试加载 zvec Python 模块
async function tryLoadZvec(): Promise<boolean> {
  if (zvecAvailable) return true
  try {
    // 动态导入 Python bridge
    const { execSync } = await import('node:child_process')
    const result = execSync('python3 -c "import zvec; print(zvec.__version__)"', {
      timeout: 5000, encoding: 'utf-8',
    }).trim()
    if (result && !result.includes('Error') && !result.includes('Traceback')) {
      zvecAvailable = true
      console.log('[ZvecBridge] ✅ zvec Python 模块已加载 v' + result)
      return true
    }
  } catch {
    // zvec Python bindings 不可用，回退到 hash-BOW
  }
  return false
}

// 同步检测 (启动时)
tryLoadZvec().catch(() => {})

export interface ZvecEmbeddingResult {
  vector: number[]
  dim: number
  engine: 'zvec' | 'hash-bow'
  latencyMs: number
}

/**
 * 统一嵌入接口 — 自动选择最优引擎
 */
export async function embed(text: string, dim = 768): Promise<ZvecEmbeddingResult> {
  const t0 = Date.now()
  
  if (zvecAvailable) {
    try {
      const { execSync } = await import('node:child_process')
      const vecJson = execSync(
        `python3 -c "import zvec,json; v=zvec.embed('''${text.replace(/'/g, "\\'")}'''); print(json.dumps(v.tolist() if hasattr(v,'tolist') else list(v)))"`,
        { timeout: 10000, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      ).trim()
      const vector = JSON.parse(vecJson)
      return { vector, dim: vector.length, engine: 'zvec', latencyMs: Date.now() - t0 }
    } catch {
      // zvec 调用失败，回退
      console.log('[ZvecBridge] zvec 调用失败，回退到 hash-BOW')
    }
  }
  
  // Hash-BOW 回退 (与 vector-memory.ts 一致)
  const hashDim = 256
  const vec = new Array(hashDim).fill(0)
  const tokens = text.toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/[\s]+/)
    .filter(t => t.length >= 2)
  
  for (const token of tokens.slice(0, 200)) {
    let h = 0
    for (let i = 0; i < token.length; i++) h = ((h << 5) - h + token.charCodeAt(i)) | 0
    vec[Math.abs(h) % hashDim] += 1
  }
  
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (mag > 0) for (let i = 0; i < hashDim; i++) vec[i] /= mag
  
  return { vector: vec, dim: hashDim, engine: 'hash-bow', latencyMs: Date.now() - t0 }
}

/**
 * 批量嵌入
 */
export async function embedBatch(texts: string[], dim = 768): Promise<ZvecEmbeddingResult[]> {
  return Promise.all(texts.map(t => embed(t, dim)))
}

/**
 * 引擎状态
 */
export function getEngineStatus(): { available: boolean; engine: string; dim: number } {
  return {
    available: zvecAvailable,
    engine: zvecAvailable ? 'zvec' : 'hash-bow',
    dim: zvecAvailable ? 768 : 256,
  }
}

// 导出用于 vector-memory.ts 升级
export { zvecAvailable }
