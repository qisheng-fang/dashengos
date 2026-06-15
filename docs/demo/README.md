# DaShengOS 5 分钟演示 · 录制指南

## 设备 / 软件

- **OS**: macOS / Windows / Linux 任一 (Mac 优先, Retina 录屏清晰)
- **录屏软件**:
  - macOS: QuickTime (内置, 够用) / OBS Studio (更专业) / ScreenFlow
  - Windows: OBS Studio
  - Linux: OBS Studio + SimpleScreenRecorder
- **麦克风**: AirPods Pro / 桌面麦 (拉近距离, 减少环境噪音)
- **浏览器**: Chrome 120+ (打开 DevTools, 关掉无关扩展, 避免通知)
- **终端**: iTerm2 (24pt 字号) / Windows Terminal / GNOME Terminal
- **配色**: dark mode (DaShengOS 默认, 录出来好看)

## 录制前准备

1. **起完整 stack** (backend + agent + daemon + web):
   ```bash
   ./scripts/record-demo.sh
   # 自动启: :8000 backend / :8001 agent (brain=deerflow) / :3000 web dev / deerflow daemon
   ```

2. **浏览器开** http://localhost:3000, **登录** (用 GitHub OIDC 真登)

3. **关干扰**:
   - macOS 系统通知全关
   - 飞书/微信/Slack 关掉
   - 浏览器其他 tab 全关
   - Do Not Disturb 模式开 (macOS / Win10+ / GNOME)

4. **预热** (录前 5 分钟): 把 Chat 屏开起来, 跑 1 次 demo 流程, 让 DeerFlow daemon 预热

5. **椅子摆正 + 灯调好 + 麦克风测一下** (录 1 句 "DaShengOS 测试" 听回放)

## 录制

按 [demo-script.md](./demo-script.md) 一气呵成, **1-2 take 过**。

- **不剪辑** = 真实感 (投资人喜欢看真东西)
- **错了重来整段** (错 1 次不重录, 错 3 次才重录整段)
- **节奏**: 别赶, 留 1-2 秒停顿让画面呼吸
- **口播**: 大声 + 清晰 + 自然, 别背稿 (背稿听起来假)

## 输出

- **原始**: 4K MP4 (Mac: `cmd+shift+5` 录 4K) / H.264, 30fps
- **剪辑** (轻量):
  - 头尾加 logo + 标题
  - 中间不剪 (B 原则: 真实感 > 完美)
- **上传**:
  - YouTube (unlisted) — 投资人 / 海外用户
  - B 站 — 国内用户
  - 自托管 `docs/demo/dashengos-5min.mp4` — README 引用
- **缩略图**: 1280x720 PNG (DaShengOS logo + 一句话价值主张, 大字号)

## 字幕

- **自动**: YouTube 就有 (中文识别率还行, 后期校对)
- **硬字幕**: 上传 .srt (B 站要求), 用剪映 / Aegisub 生成

## 背景音乐

**不要** — B 站审核麻烦 (BGM 经常被识别为版权), 录 5 分钟也不需要, 节奏紧凑就够

## 文件位置

录完:
- 原始: `~/Desktop/dashengos-5min-raw.mov` (老板本机)
- 剪辑: `docs/demo/dashengos-5min.mp4` (进 git, 5-20MB 合理)
- 缩略图: `docs/demo/dashengos-5min-thumb.png`
- 字幕: `docs/demo/dashengos-5min.zh-CN.srt`

## 老板拍板后 (1 小时内)

1. 录 + 剪 + 缩略图
2. 上传 YouTube + B 站
3. 链接贴到:
   - `README.md` (顶部 "📺 5 分钟演示")
   - 投资人 outreach 文案
   - Twitter / 微博 (1 句 + 视频)
