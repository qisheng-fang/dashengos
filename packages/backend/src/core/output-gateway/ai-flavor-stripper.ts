// AI Flavor Stripper v2.2 — 保留人情味 + 保护代码块/图表
// v2.2: 跳过 fenced code blocks (```...```) 内的内容，保护 Mermaid/代码/图表

// ═══════════════════════════════════════════════════════
//  STRIP: 真正的 AI 废话
// ═══════════════════════════════════════════════════════

const REPETITIVE_LEADING: RegExp[] = [
  /^(好的[，,]?\s*)+(?=好的|让我|我来|根据|以下|这是)/gi,
  /^(明白[了]?[，,]?\s*)+(?=明白|让我|好的|以下|这是)/gi,
  /^(收到[！!，,]*\s*)+(?=收到|根据|以下|这是)/gi,
]

const AI_SELF_REFERENCE: RegExp[] = [
  /作为(一个|一名)?AI(助手|语言模型|智能助手|助理)?[，,]?\s*/gi,
  /作为(一个人工智能|人工智能助手)[，,]?\s*/gi,
  /^我是一个AI[，,]?\s*/gim,
]

const THINKING_ALOUD: RegExp[] = [
  /^(让我想想[，,：:！!\s.]*)+/gim,
  /^(让我思考(一下)?[，,：:！!\s]*)+/gim,
  /^(让我分析(一下)?[，,：:！!\s]*)+/gim,
  /^(嗯[，,]+\s*)+/gim,
  /^(Hmm[，,!\s]*)+/gim,
]

const TRAILING_SPAM: RegExp[] = [
  /希望(?:这|以上|这些)(?:对(?:你|您)|能)(?:有(?:所)?帮助|帮到[你您]|有用)[！!。.]*/gi,
  /祝[你您](?:工作顺利|工作愉快|生活愉快|一切顺利|使用愉快|顺利|愉快|开心)[！!。.]*/gi,
]

const EXCESSIVE_APOLOGY: RegExp[] = [
  /^(?:非常)?抱歉(?:，|,|。|!|！|\s)+/gi,
  /^(?:很|非常)不好意思(?:，|,|。|!|！|\s)+/gi,
  /^I(?:'m)?\s*(?:really\s*)?sorry[，,!\s]*(?=I|that|the|this)/gi,
]

const HOLLOW_FILLER: RegExp[] = [
  /^(?:综上所述|总的来看|总的说来)[，,]\s*/gim,
  /^(?:值得注意的是|需要说明的是|需要指出的是)[，,]\s*/gim,
  /^(?:简而言之|长话短说)[，,]\s*/gim,
]

const CTA_ENDING: RegExp[] = [
  /[\s\n]*(?:以上[，,]?\s*)?(?:就是|便是|即为)(?:我的|本次的)?(?:回答|分析|建议|方案|回复)(?:[。.]\s*)?$/gi,
  /[\s\n]*以上[。.]?\s*$/gi,
]

const EMOJI_LIGHT_CLEANUP = /[🤗🫡🥰😘💋🙏👏🎉🥳🎊💯]/g
const EXCESSIVE_EXCLAMATION = /([！!]){2,}/g

// ═══════════════════════════════════════════════════════
//  v2.2: 保护代码块 — 提取 → 清理 → 还原
// ═══════════════════════════════════════════════════════

function protectCodeBlocks(text: string): { cleaned: string; blocks: string[] } {
  const blocks: string[] = []
  // Match fenced code blocks: ```lang\n...\n```
  let cleaned = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, content) => {
    const idx = blocks.length
    blocks.push('```' + lang + '\n' + content + '```')
    return '%%CODEBLOCK_' + idx + '%%'
  })
  return { cleaned, blocks }
}

function restoreCodeBlocks(text: string, blocks: string[]): string {
  return text.replace(/%%CODEBLOCK_(\d+)%%/g, (_match, idx) => {
    const i = parseInt(idx, 10)
    return blocks[i] || ''
  })
}

// ── AI 格式符号清理 (仅对非代码块内容) ──

function cleanAIFormatting(text: string): string {
  let t = text
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  t = t.replace(/(?:^|\s)\*([^*\n]+)\*(?:\s|$|[，,。.！!？?])/g, ' $1 ')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/^_{3,}$/gm, '')
  t = t.replace(/^-{3,}$/gm, '')
  t = t.replace(/(?<!`)`([^`\n]+)`(?!`)/g, '$1')
  t = t.replace(/^> ?/gm, '')
  t = t.replace(/^- (?=[\u4e00-\u9fa5])/gm, '')
  return t
}

// ═══════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════

export interface StripResult {
  text: string
  stripped: string[]
  changed: boolean
}

export function stripAIFlavor(text: string): StripResult {
  const stripped: string[] = []
  let cleaned = text

  const original = text.trim()
  if (original.length <= 10 && /^[\u4e00-\u9fa5a-zA-Z\s！!，,。.?？～~-]+$/.test(original)) {
    return { text: original, stripped: [], changed: false }
  }

  // v2.2: 保护代码块
  const { cleaned: protected_text, blocks } = protectCodeBlocks(cleaned)
  cleaned = protected_text

  for (const p of REPETITIVE_LEADING) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) { const m = before.match(p); if (m) stripped.push('rep:"' + m[0].trim() + '"') }
  }
  for (const p of AI_SELF_REFERENCE) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) { const m = before.match(p); if (m) stripped.push('ai:"' + m[0].trim() + '"') }
  }
  for (const p of THINKING_ALOUD) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) { const m = before.match(p); if (m) stripped.push('think:"' + m[0].trim() + '"') }
  }
  for (const p of EXCESSIVE_APOLOGY) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) { const m = before.match(p); if (m) stripped.push('sorry:"' + m[0].trim() + '"') }
  }
  for (const p of TRAILING_SPAM) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) { const m = before.match(p); if (m) stripped.push('spam:"' + m[0].trim().slice(0,30) + '"') }
  }
  for (const p of HOLLOW_FILLER) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) { const m = before.match(p); if (m) stripped.push('fill:"' + m[0].trim() + '"') }
  }
  for (const p of CTA_ENDING) {
    const before = cleaned; cleaned = cleaned.replace(p, '')
    if (cleaned !== before) stripped.push('cta')
  }

  cleaned = cleaned.replace(EMOJI_LIGHT_CLEANUP, '')
  cleaned = cleaned.replace(EXCESSIVE_EXCLAMATION, '！')
  
  // v2.2: 还原代码块后再做格式化清理
  cleaned = restoreCodeBlocks(cleaned, blocks)
  // 对非代码块部分做清理（代码块已还原，不会被影响）
  cleaned = cleanAIFormatting(cleaned)
  
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n').replace(/^[\s\n]+/, '').replace(/[\s\n]+$/, '').replace(/^[，,]\s*/, '').replace(/^[！!]\s*/, '')

  const result = cleaned.trim()
  if (!result || result.length < 3) return { text: original, stripped, changed: false }
  return { text: result, stripped, changed: result !== original }
}

export function stripAIFlavorText(text: string): string {
  return stripAIFlavor(text).text
}

export function cleanHtmlOutput(raw: string): string {
  let html = raw
  html = html.replace(/```html?\s*/gi, '').replace(/```\s*/g, '')
  const di = html.indexOf('<!DOCTYPE'), hi = html.indexOf('<html')
  let si = di >= 0 ? di : hi
  if (si < 0) si = html.indexOf('<')
  if (si > 0) html = html.slice(si)
  html = html.replace(/\n?```\s*$/, '')
  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
    const m = html.match(/<![Dd][Oo][Cc][Tt][Yy][Pp][Ee]|<html/i)
    if (m?.index && m.index > 0) html = html.slice(m.index)
  }
  return html.trim()
}
