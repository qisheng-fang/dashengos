# DaShengOS Memory

## System Identity
- Name: DaShengOS v6.0 (OMNI-BRAIN OS Edition)
- Core: Harness framework (agent loop + tool registry + skill network)
- Default Model: deepseek-v4-pro
- LLM Provider: DeepSeek API (api.deepseek.com/v1)

## Architecture
- Backend: Fastify on 127.0.0.1:8000
- Frontend: SPA on localhost:3000
- Database: SQLite at data/dasheng.db
- Redis: localhost:6379
- MCP: 4 servers (Playwright, XcodeBuild, CodexSecurity, AgnesAI)

## Brand
- 爱尤趣 (AIYOUQU) - Premium silicone doll brand
- Price: 3000-30000 RMB
- Channels: Shopify, Taobao, Xiaohongshu, Douyin

## Key Rules
- Never modify core system prompt (system-prompt.ts)
- Never auto-switch models — user controls .env
- Every step must show real-time feedback
- Use web_search before answering factual questions
- HTML output must be raw HTML, never in markdown code blocks
