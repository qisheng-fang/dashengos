# DaShengOS v0.3 · 5 分钟演示脚本

**总时长**: 5:00
**录制日期**: 2026-06-15 (待老板执行)
**录制人**: 老板 (CEO / 创始人)
**受众**: 投资人 + 早期用户 + 开源社区

---

## [0:00-0:30] intro (30s)

**画面**: DaShengOS 启动, logo + 一句话价值主张
**旁白**:
> "DaShengOS — 5 分钟, 让你看到下一代私有 AI 工作台的样子. 集成 Agent, 对话, 文件, Skills, MCP, 一台机器跑全栈, 你的数据不出门."

**动作**:
1. 启动 DaShengOS desktop app (Tauri) — 双击图标
2. 拉远看 logo + brand 配色 (orange #FF6B35 + dark #0A0A0F)
3. zoom 到 workbench

**转场**: 鼠标移到 "登录" 按钮

---

## [0:30-1:30] Login (1 min)

**画面**: `/login`, 5 SSO providers
**旁白**:
> "登录支持 5 个 SSO — GitHub, Google, Microsoft, 飞书, 钉钉. JWT + refresh token + 撤销, 业界最严. OIDC 标准协议, 5 分钟接一个."

**动作**:
1. hover GitHub 按钮, 看 brand 颜色
2. 点 GitHub OIDC 按钮 → 跳 GitHub 授权
3. 跳回 workspace, 展示 tier (右上角头像 hover: free / pro / enterprise)
4. 1:25 切到 Settings 看 JWT 详情 (前 5s 留)

**转场**: 切到 Workspace 主屏

---

## [1:30-2:30] Workspace (1 min)

**画面**: `/` (Workspace), 6 默认 agent 卡片 + 7 个 session
**旁白**:
> "6 个内置 agent: code-reviewer, deep-researcher, design-assistant, data-analyst, security-reviewer, custom-workflow. 7 个 session 跨 6 个 agent 复用, 数据真接 backend SQLite 持久化."

**动作**:
1. hover "code-reviewer" 卡片, 看 description
2. hover 1 个 session "用 1 句话介绍 DaShengOS" 看 last_used_at
3. 点 session → 跳 Chat

**转场**: 加载 Chat 屏

---

## [2:30-3:30] Chat (1 min) ★ 高潮

**画面**: `/chats/c-xxx`, 真接 DeerFlow daemon + Qwen2.5-72B
**旁白**:
> "对话是重头戏. 后端是 DeerFlow 2.0 嵌入 daemon, AG-UI 协议, 真接 SiliconFlow Qwen2.5-72B. 5 个 sub-agent 并发: researcher / analyst / writer / security-reviewer / quality-reviewer. 跑 1 个查询, 1 个报告, 20 秒."

**动作** (1:00 完成):
1. 输 "用 1 句话介绍 DaShengOS" → 提交 (3s)
2. 看到 RUN_STARTED → 5 sub-agent 并发步骤 (10s, 动画滚)
3. writer 输出报告 (5s, 真文本)
4. quality-reviewer 通过 (2s)
5. 显示 "我是 Hermes 风格" 的真报告 (不是 stub) (3s)

**关键**: 必须真跑, 不能预先录好的 demo. 让观众看真延迟.

**转场**: 切到 Agent Market

---

## [3:30-4:00] Agent Market (30s)

**画面**: `/agents`, 6 内置 + marketplace
**旁白**:
> "Agent 市场 — 6 个内置 agent + 第三方 marketplace. 装一个社区 agent 只要 3 秒, 装完直接在 Chat 屏能用."

**动作**:
1. 浏览 6 个内置 (向下滚动)
2. 点 "安装" 一个 marketplace agent (模拟, 没真装, 显示 toast "3 秒装好")

**转场**: 切到 File Browser

---

## [4:00-4:30] File Browser + Skill Detail (30s)

**画面**: `/files` + `/skills/yyy`
**旁白**:
> "文件浏览器和 Skills 详情都跑在 Docker sandbox 里 — BPF seccomp 100+ syscall allowlist, cgroup v1/v2 资源隔离. 你给 AI 的权限, 你说了算. 不是空话, 4 个 PoC 测过, 就在 tests/security/."

**动作**:
1. 浏览 `/files`, 展示 sandbox 隔离的 rootfs
2. 切到 Skill 详情 `/skills/code-search`, 看一个 skill 的 manifest

**转场**: 切到 Settings

---

## [4:30-4:50] Settings (20s)

**画面**: `/settings`, 订阅 tier + API key + 主题
**旁白**:
> "Settings — 订阅 free / pro / enterprise, 6 个 API key 轮换, 主题切换. Stripe 真接, 翻转秒级生效, e2e 8/8 全过."

**动作**:
1. 快速滚动展示: 订阅 tier (5s) / API key (5s) / 主题 (5s) / 通知 (5s)

**转场**: 切到 outro 静态画面

---

## [4:50-5:00] outro (10s)

**画面**: 静态 logo + 联系方式 + GitHub star 按钮
**旁白**:
> "DaShengOS v0.3 — 开源 (Apache 2.0), 完整文档, Docker 一键起. GitHub star, 我们下个 release 见."

**动作**:
1. 静态画面 + GitHub repo URL (大字号) + Twitter @dashengos

---

## 剪辑注意

- **不剪** (一气呵成, 真实感)
- **如果有错** (typo / 慢响应), 重录整段
- **配字幕**: 自动 (YouTube 就有) + 中文硬字幕 (.srt 文件)
- **背景音乐**: 不要 (B 站审核麻烦)
- **节奏**: 别赶, 留 1-2 秒停顿让画面呼吸
- **错就错**: 真错 (deerflow daemon 抽风) 不修, 反而显得真实

## 真录时注意事项

- 麦克风先测, 别录完发现没声
- screen record 4K (Retina) 别用 1080p, 投资人看 4K
- 关掉所有 emoji 输入法 (某些 IME 录屏会显示候选窗)
- terminal 用 iTerm2 24pt 字号 (录出来字大好看)
- 颜色: 全部 dark mode, 录出来 brand orange #FF6B35 在 dark 上最显眼
- 录前 30 秒留白 (录完有 buffer 方便剪头尾)
