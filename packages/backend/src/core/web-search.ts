// packages/backend/src/core/web-search.ts · Track C.2 (2026-06-17)
// Web Search tool for autonomous task execution
// Uses DuckDuckGo HTML scraping (no API key needed)

export interface SearchResult {
  title: string
  snippet: string
  url: string
}

export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DaShengOS/0.3',
      },
      // ★ 缩短超时到 5s，避免阻塞 LLM
      signal: AbortSignal.timeout(5_000),
    })

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const html = await resp.text()
    return extractResults(html, maxResults)
  } catch (e: any) {
    console.warn(`[web-search] Failed: ${e.message?.slice(0, 100) || 'unknown'}`)
    return []
  }
}

function extractResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []
  
  // Simple regex-based extraction from DuckDuckGo HTML
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi
  
  let match
  while ((match = resultRegex.exec(html)) !== null && results.length < max) {
    const url = decodeURIComponent(match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, ''))
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()
    
    if (title && snippet) {
      results.push({ title, snippet, url })
    }
  }
  
  // Fallback: basic extraction
  if (results.length === 0) {
    const altRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi
    while ((match = altRegex.exec(html)) !== null && results.length < max) {
      results.push({ title: match[2].trim(), snippet: '', url: match[1] })
    }
  }
  
  return results
}

/** Search + format results for LLM consumption */
export async function searchAndFormat(query: string): Promise<string> {
  const results = await webSearch(query)
  if (results.length === 0) return '未找到相关搜索结果。'
  
  return results.map((r, i) => 
    `[${i + 1}] ${r.title}\n    ${r.snippet}\n    ${r.url}`
  ).join('\n\n')
}
