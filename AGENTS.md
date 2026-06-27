# AGENTS.md — AI Agent 操作约束

> 任何 AI Agent（包括 DaShengOS Bot、Codex CLI、或其他自动化工具）在操作本仓库时，
> 必须遵守以下硬约束。违反任一条目将导致系统降级或数据丢失。

---

## 1. 端口管理 🔴 最高优先级

| 端口 | 服务 | 绑定进程 | 管理方式 |
|------|------|----------|----------|
| 8000 | Fastify 后端 | `packages/backend/dist/server.js` | screen dasheng-backend |
| 3000 | Vite 前端 (生产构建) | `apps/web/dist` (vite preview) | launchd com.dasheng.frontend |
| 6379 | Redis | redis-server | brew services |

- **禁止**在任何新建脚本中硬编码端口 8000/3000/8002
- **禁止**创建占用上述端口的新服务
- 新增服务必须使用端口 ≥ 8900，并在 `.env` 的 `PORT_ALLOCATION` 字段注册

---

## 2. 进程管理 🔴

- **后端**: `screen` 管理
- **前端**: `launchd` plist 管理 (`com.dasheng.frontend.plist`)
- **禁止**使用 `nohup` 或 `&` 直接后台化关键服务
- 启动/重启必须通过 `start.sh` 或 `restart.sh`

---

## 3. 端点契约 🔴

以下端点**必须**返回真实数据，禁止假响应：

| 端点 | 最小断言 |
|------|----------|
| `GET /api/v1/sessions` | `sessions.length >= 0`（从 SQLite 读取） |
| `GET /api/v1/skills/marketplace` | `skills.length >= 90` |
| `GET /api/v1/health/ping` | 实际进程探活，非硬编码 |
| `GET /api/status` | DB 统计数据与 SQLite 一致 |

- **禁止**创建返回硬编码空数组/假数据的端点
- 如需占位，返回 HTTP 501 Not Implemented，而非假 200

---

## 4. 数据库 🔴

- 唯一数据库: `packages/backend/data/dasheng.db`（SQLite）
- **禁止**创建新的数据库文件绕过主库
- **禁止**在 mini-backend 或其他脚本中硬编码假数据替代真实查询

---

## 5. 代码变更规范

- **禁止**删除或替换 `packages/backend/src/` 下的任何 `.ts` 文件
- 新增 API 端点必须通过 Fastify 插件注册（`app.register(xxxRoutes, { prefix: '/api/v1/xxx' })`）
- 如需创建独立 Python 脚本，放入 `scripts/` 目录，且不得监听 8000/3000 端口
- 修改 `start.sh` / `restart.sh` 前必须确认不影响现有服务

---

## 6. 安全检查

- `.env` 中的 API Key 仅在内存中使用，不得写入新文件或日志
- 不得在提交中包含 `sk-` 或 `whsec_` 开头的密钥
- 新增依赖必须通过 `pnpm add`（Node）或 `pip install`（Python .venv）

---

## 7. STATE.md 同步

- 修改服务架构后**必须**更新 `STATE.md` 对应章节
- `STATE.md` 中声称的状态必须与 `curl http://127.0.0.1:8000/api/status` 输出一致

---

## 8. 快速自检

```bash
# 运行此脚本验证关键端点
curl -s http://127.0.0.1:8000/api/status | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['backend']['running'], 'Backend not running!'
assert d['db']['sessions'] >= 0, 'DB not accessible!'
print('✅ All checks passed')
"
```

---

## 9. 系统提示词保护 🔴 新增

- **系统提示词存放位置**: `packages/backend/src/core/system-prompt-config.ts`
- 此文件独立于业务逻辑，**只能由人工修改**
- AI Agent 在任何情况下都**不得**修改此文件
- 如需调整 AI 行为，在 `data/wiki/SYSTEM.md` 中追加，由配置层合并

## 10. 关键文件保护 🔴 新增

- `.codex-protect` 文件列出了所有受保护的关键文件
- 修改受保护文件前必须：
  1. 向用户明确说明修改内容和原因
  2. 等待用户确认
  3. 不能以"优化""重构"等模糊理由擅改
- `system-prompt-config.ts` 为 🔴 绝对禁止级别

## 11. 系统提示词哈希保护 🔴 新增 (v6.1)

- 系统提示词文件 `packages/backend/src/core/harness/system-prompt.ts` 受 SHA-256 哈希保护
- 哈希值存储在 `.codex-protect-hash` 文件中
- 每次 `git commit` 前，pre-commit hook 会验证哈希
- AI Agent 修改此文件后**必须**同步更新哈希值：
  ```bash
  shasum -a 256 packages/backend/src/core/harness/system-prompt.ts | cut -d' ' -f1 > .codex-protect-hash
  ```
- 未经哈希更新的提示词修改将被 pre-commit hook 拦截

## 12. 配置持久化规范 🔴 新增 (v6.1)

- `.env.persist` 是环境变量的"黄金源"——永远不删除，只追加
- 核心模块配置（MCP、Providers、Skills）持久化到 SQLite，不依赖文件系统
- 自动备份每 6 小时运行一次，保留最近 30 个快照
- 备份内容包括: DB + .env + system-prompt.ts + MCP 配置
- 恢复命令: 从 backups/ 目录选择最近的 dasheng-*.db 复制到 packages/backend/data/dasheng.db

## 9. 系统提示词 🔴🔴🔴 最高优先级 — 不可变 CANON

- **唯一真相来源**: `packages/backend/src/core/harness/system-prompt-canon.ts` (291行)
- **SHA256**: `bfc03214b1e0d168f63963b27ab15a026d371d0d75959bc5044c4152c3b7a2eb`
- **规则**:
  - ❌ **禁止删除** 此文件或其任何备份
  - ❌ **禁止修改** 现有章节 — 仅允许在末尾 **追加** 新章节
  - ❌ **禁止改变** 身份定义 ("Omni-Brain", "DaShengOS v6.1")
  - ❌ **禁止削弱** 反废话协议 (SECTION 0)
  - ❌ **禁止移除** MACROS / FEW-SHOT / STATE MACHINE / SAFETY GATES
  - ✅ **允许追加** 新 SECTION（需同步更新 SHA256 + CANON.md）
- **永久备份**: `.canon/system-prompt-canon.v1.0.0.ts` · `backups/dasheng-canon-permanent.ts`
- **权限**: `chmod 444` — 文件系统级只读
- **启动校验**: 每次启动打印 `[IntegrityGuard] System prompt integrity verified ✅`
- **校验失败**: `process.exit(1)` — 拒绝启动
- **违规后果**: 系统降级 · 人格丢失 · 用户信任崩塌

## 10. CANON 校验命令

```bash
cd packages/backend && npx tsx --eval "
import { verifyPromptIntegrity } from './src/core/harness/system-prompt-canon.ts';
console.log(verifyPromptIntegrity());
"
```

## 11. 恢复程序

如果 canon 被意外修改:
```bash
cp backups/dasheng-canon-permanent.ts packages/backend/src/core/harness/system-prompt-canon.ts
chmod 444 packages/backend/src/core/harness/system-prompt-canon.ts
```
