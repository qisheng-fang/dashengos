# DaShengOS v6.0 系统状态快照
> 审计日期: 2026-06-23
> 审计结果: ✅ 全系统通过

---

## 1. 核心服务 ✅

| 服务 | 端口 | 状态 | 启动方式 |
|------|------|------|----------|
| 后端 API | 8000 | ✅ | screen dasheng-backend |
| 前端 SPA | 3000 | ✅ | screen dasheng-frontend |
| Redis | 6379 | ✅ | redis-server |
| SQLite | file | ✅ | data/dasheng.db (7.4MB) |

## 2. 模型链路 ✅

| 模型 | 来源 | 状态 |
|------|------|------|
| deepseek-v4-pro | DeepSeek API | ✅ 默认 |
| Qwen2.5-72B | SiliconFlow | ✅ 备用 |

## 3. MCP 服务器 ✅ (4/4, 89 工具)

| 服务器 | 状态 |
|--------|------|
| Playwright Browser | ✅ |
| Xcode Build MCP | ✅ |
| Codex Security | ✅ |
| Agnes AI | ✅ |

## 4. 工具链 ✅

- 23 核心工具 (core/file/research/agent/skill/audit/secret/browser/subagent/metrics)
- Function calling 工具: web_search, web_fetch, read_file, write_file, run_command 等
- Agent Loop: THINK → TOOL → RESPOND 完整闭环

## 5. 前端路由 ✅

| 路由 | 状态 |
|------|------|
| /login | ✅ |
| / (工作台) | ✅ |
| /chats/:id | ✅ |
| /terminal | ✅ 新修复 |
| /open-design | ✅ daemon 端口检测 |
| /openmontage | ✅ |
| /mcp | ✅ |
| /skills | ✅ |
| /agents, /studio, /files, /browser, /documents, /visualizations, /settings | ✅ |

## 6. 系统提示词 ✅

- system-prompt.ts: 238行, v6.0 OMNI-BRAIN OS
- ANTI-YAPPING 协议 + THINK→TOOL→RESPOND 状态机
- loop.ts: 暗号解析(macro-parser), Ghost/DeepDive/Halt
- 上下文压缩: 60000 token 阈值

## 7. 知识库 ✅

- data/wiki/MEMORY.md ✅
- data/wiki/SYSTEM.md ✅

## 8. 已修复的 Bug

| Bug | 修复 | 文件 |
|-----|------|------|
| DeepSeek 模型丢失 | 动态发现 provider | misc.ts |
| DEFAULT_MODEL 覆盖 | LLM_PROVIDER 按 provider 解析 | misc.ts + .env |
| 终端路由未注册 | 加入路由树 | main.tsx |
| OpenDesign 重复启动 | 端口检测 | daemon.ts |
| Wiki 目录缺失 | 创建 + 种子内容 | data/wiki/ |

## 9. 快速命令

```bash
# 一键启动
/Users/apple/Desktop/ai-workbench-v2/start.sh

# 重连 screen
screen -r dasheng-backend
screen -r dasheng-frontend

# 查看日志
tail -f /tmp/dasheng-backend.log

# 重建前端
cd apps/web && npx vite build
```

## 10. 已知限制

- node-pty 与 macOS 不兼容 → 使用 spawn 替代 (无真 PTY)
- 前端 MCP 页可能显示离线 → API 实际在线, 前端缓存问题硬刷新即可
- Playwright 浏览器未安装 → MCP Playwright 仍可用 (headless)
