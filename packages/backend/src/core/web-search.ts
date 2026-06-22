// packages/backend/src/core/web-search.ts · Track C.3 (2026-06-21)
// Web Search tool for autonomous task execution
// v5.1: 多引擎+重试+备用, 解决 DuckDuckGo 在中国不可用问题

export interface SearchResult {
  title: string
  snippet: string
  url: string
}

interface SearchEngine {
  name: string
  search: (query: string, maxResults: number) => Promise<SearchResult[]>
}

// ─── DuckDuckGo HTML 抓取 ────────────────────────────────

async function duckduckgoSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  // DuckDuckGo Instant Answer API (no HTML scraping needed)
  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'DaShengOS/0.6.0' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    const results: SearchResult[] = []
    
    // Abstract/Definition
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || 'Result',
        snippet: data.AbstractText.slice(0, 300),
        url: data.AbstractURL,
      })
    }
    // Related Topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0]?.slice(0, 100) || topic.Text.slice(0, 80),
            snippet: topic.Text.slice(0, 200),
            url: topic.FirstURL,
          })
        }
      }
    }
    if (results.length > 0) return results.slice(0, maxResults)
  } catch { /* fall through to HTML scraping */ }
  
  // Fallback: HTML scraping
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const resp = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3.1',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(6_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const html = await resp.text()
  return extractDuckDuckGoResults(html, maxResults)
}

function extractDuckDuckGoResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi
  let match
  while ((match = resultRegex.exec(html)) !== null && results.length < max) {
    const url = decodeURIComponent(match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, ''))
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()
    if (title && snippet) results.push({ title, snippet, url })
  }
  if (results.length === 0) {
    const altRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi
    while ((match = altRegex.exec(html)) !== null && results.length < max) {
      results.push({ title: match[2].trim(), snippet: '', url: match[1] })
    }
  }
  return results
}

// ─── Bing 搜索 (备用引擎) ─────────────────────────────────

async function bingSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  // cn.bing.com works from China; www.bing.com redirects
  const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`
  const resp = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(6_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const html = await resp.text()

  const results: SearchResult[] = []
  // Bing 搜索结果：<li class="b_algo"> ... <h2><a href="...">title</a></h2> ... <p>snippet</p>
  const blockRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi
  let blockMatch
  while ((blockMatch = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = blockMatch[1]
    const titleMatch = block.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i)
    const snippetMatch = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    if (titleMatch) {
      results.push({
        title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        url: titleMatch[1],
      })
    }
  }
  return results
}

// ─── Google 搜索 (最终备用) ───────────────────────────────

async function googleSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN`
  const resp = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(6_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const html = await resp.text()

  const results: SearchResult[] = []
  // Google 搜索结果提取
  const blockRegex = /<div class="g"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi
  let match
  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1]
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/i)
    const snippetMatch = block.match(/<span class="[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    if (linkMatch) {
      results.push({
        title: linkMatch[2].replace(/<[^>]+>/g, '').trim(),
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        url: linkMatch[1],
      })
    }
  }
  return results
}


// ─── SearXNG 公共实例 (隐私搜索引擎，国内可访问) ──────────

const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.sapti.me',
  'https://searx.tiekoetter.com',
  'https://searx.work',
  'https://search.bus-hit.me',
]

async function searxngSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  for (const baseUrl of SEARXNG_INSTANCES) {
    try {
      const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`
      const resp = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3.1',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      })
      if (!resp.ok) continue
      const data = await resp.json() as { results?: Array<{ title: string; content: string; url: string }> }
      const results = (data.results || []).slice(0, maxResults).map(r => ({
        title: r.title || '',
        snippet: (r.content || '').replace(/<[^>]+>/g, '').slice(0, 300),
        url: r.url || '',
      }))
      if (results.length > 0) {
        console.log(`[web-search] SearXNG (${new URL(baseUrl).hostname}) returned ${results.length} results`)
        return results
      }
    } catch { /* try next instance */ }
  }
  return []
}

// ─── 引擎列表 (按优先级排列) ─────────────────────────────

const ENGINES: SearchEngine[] = [
  { name: 'Bing', search: bingSearch },
  { name: 'DuckDuckGo', search: duckduckgoSearch },
  { name: 'SearXNG', search: searxngSearch },
  { name: 'Google', search: googleSearch },
]

// ─── 主搜索函数 (多引擎 + 重试) ──────────────────────────

export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  // 尝试每个引擎，每个引擎最多 2 次重试
  for (const engine of ENGINES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const results = await engine.search(query, maxResults)
        if (results.length > 0) {
          console.log(`[web-search] ${engine.name} returned ${results.length} results (attempt ${attempt + 1})`)
          return results
        }
        // 结果为空，尝试下一个引擎
        break
      } catch (e: any) {
        const errMsg = e.message?.slice(0, 80) || 'unknown'
        if (attempt === 0) {
          // 第一次失败，重试
          console.warn(`[web-search] ${engine.name} attempt ${attempt + 1} failed: ${errMsg}, retrying...`)
          await new Promise(r => setTimeout(r, 500)) // 短暂延迟再重试
        } else {
          console.warn(`[web-search] ${engine.name} failed after 2 attempts: ${errMsg}, trying next engine...`)
        }
      }
    }
  }

  console.warn(`[web-search] All engines failed for query: "${query.slice(0, 60)}"`)
  return []
}

/** Search + format results for LLM consumption */
export async function searchAndFormat(query: string): Promise<string> {
  const results = await webSearch(query)
  if (results.length === 0) return '未找到相关搜索结果。'

  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    ${r.snippet}\n    ${r.url}`
  ).join('\n\n')
}
