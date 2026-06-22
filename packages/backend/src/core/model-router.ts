// packages/backend/src/core/model-router.ts · DaShengOS v6
// 智能模型路由 — 按任务类型自动选择最优模型
// 2026-06-22

interface ModelRoute {
  provider: string
  model: string
  reason: string
}

interface ProviderInfo {
  name: string
  displayName: string
  defaultModel: string
  fallbackModels: string[]
  supportsTools: boolean
  supportsVision: boolean
  contextWindow: number
}

// ─── Task Type Detection ─────────────────────────────────

function detectTaskType(message: string): {
  type: 'coding' | 'analysis' | 'creative' | 'vision' | 'chat'
  confidence: number
} {
  const m = message.toLowerCase()

  const codingPatterns = [
    /代码|编程|bug|错误|修复|fix|refactor|重构|实现|implement|函数|function|class|api|接口|组件|component|测试|test|build|编译|部署|deploy|config/,
    /写一个|创建一个|生成一个|帮我写|修改.*文件|优化.*代码/,
    /python|javascript|typescript|react|vue|node|sql|html|css|docker|bash/,
  ]
  const analysisPatterns = [
    /分析|报告|report|调研|research|市场|market|趋势|trend|数据|data|统计|statistics|竞品|对比|compare|行业|industry/,
    /为什么|原因|根因|root.*cause|总结|summary|评估|evaluate/,
  ]
  const creativePatterns = [
    /写.*文章|文案|copywriting|广告|ad|营销|marketing|海报|poster|设计|design|创意|creative|生成.*图|生成.*视频/,
    /故事|story|诗歌|poem|剧本|脚本|script/,
  ]
  const visionPatterns = [
    /图片|image|照片|photo|截图|screenshot|识别|recognize|ocr|看图|视觉/,
  ]

  for (const p of visionPatterns) if (p.test(m)) return { type: 'vision', confidence: 0.9 }
  for (const p of codingPatterns) if (p.test(m)) return { type: 'coding', confidence: 0.85 }
  for (const p of analysisPatterns) if (p.test(m)) return { type: 'analysis', confidence: 0.85 }
  for (const p of creativePatterns) if (p.test(m)) return { type: 'creative', confidence: 0.8 }

  return { type: 'chat', confidence: 0.7 }
}

// ─── Model Selection ──────────────────────────────────────

export function routeModel(
  message: string,
  providers: ProviderInfo[],
  activeProviderName?: string,
): ModelRoute {
  const taskType = detectTaskType(message)
  const active = activeProviderName || 'deepseek'

  // Priority order for each task type
  const taskPreferences: Record<string, string[]> = {
    coding: ['deepseek', 'siliconflow', 'qwen-local', 'ollama'],
    analysis: ['deepseek', 'siliconflow', 'google'],
    creative: ['deepseek', 'siliconflow', 'google'],
    vision: ['qwen-local', 'google', 'agnes_ai'],
    chat: ['deepseek', 'siliconflow', 'ollama'],
  }

  const preferred = taskPreferences[taskType.type] || taskPreferences.chat

  for (const providerName of preferred) {
    const provider = providers.find(p => p.name === providerName)
    if (!provider || !provider.supportsTools) continue

    // Select the best model from this provider
    let model = provider.defaultModel

    // Use reasoning model for complex tasks
    if ((taskType.type === 'coding' || taskType.type === 'analysis') && taskType.confidence > 0.8) {
      // Prefer reasoning-capable models
      if (provider.fallbackModels?.some(m => m.includes('reasoner') || m.includes('pro'))) {
        model = provider.fallbackModels.find(m => m.includes('pro') || m.includes('reasoner')) || model
      }
    }

    // Use flash/fast model for simple chat
    if (taskType.type === 'chat' && taskType.confidence < 0.8) {
      if (provider.fallbackModels?.some(m => m.includes('flash') || m.includes('lite'))) {
        model = provider.fallbackModels.find(m => m.includes('flash') || m.includes('lite')) || model
      }
    }

    return {
      provider: providerName,
      model,
      reason: `task=${taskType.type}(conf=${taskType.confidence}) → ${providerName}/${model}`,
    }
  }

  // Fallback to active provider
  const activeProvider = providers.find(p => p.name === active)
  return {
    provider: active,
    model: activeProvider?.defaultModel || 'deepseek-v4-flash',
    reason: `fallback → ${active}`,
  }
}

/**
 * Auto-select a different model if the current one fails repeatedly
 */
export function suggestFallbackModel(
  currentModel: string,
  errorType: string,
  providers: ProviderInfo[],
): ModelRoute | null {
  // If timeout or rate limit, suggest a different provider
  if (/timeout|rate.?limit|429|503/i.test(errorType)) {
    const current = providers.find(p => p.name === currentModel?.split('/')[0] || p.defaultModel === currentModel)
    const alt = providers.find(p => p.name !== current?.name && p.supportsTools)
    if (alt) {
      return {
        provider: alt.name,
        model: alt.defaultModel,
        reason: `auto-failover: ${errorType} → ${alt.name}`,
      }
    }
  }
  return null
}
