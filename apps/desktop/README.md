# DaShengOS Desktop (Tauri 2.x wrapper) · Phase 5 收官

Tauri 2.x 桌面 app wrapper, 把 `apps/web` 包成原生 desktop binary。
前端业务 100% 复用 web 端, 这里只负责 window 包装 + Rust runtime。

## 前置

- **Rust 1.74+** ([rustup.rs](https://rustup.rs))
- **Node 20+** + **pnpm 9**
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Microsoft C++ Build Tools
- **Linux**: `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`

## 跑 (dev)

```bash
cd apps/desktop
pnpm install
pnpm tauri dev
# 自动:
#   1. 启 web (apps/web vite :3000)
#   2. 启 Tauri window load http://localhost:3000
```

## 打包 (production)

```bash
cd apps/desktop
pnpm tauri build
```

产物:
- **macOS**: `src-tauri/target/release/bundle/macos/DaShengOS.app` + `dmg/`
- **Windows**: `src-tauri/target/release/bundle/msi/DaShengOS-0.3.0-x86_64.msi`
- **Linux**: `src-tauri/target/release/bundle/{deb,appimage}/`

多平台:
```bash
pnpm tauri build --target universal-apple-darwin     # macOS universal
pnpm tauri build --target x86_64-unknown-linux-gnu   # Linux
pnpm tauri build --target x86_64-pc-windows-msvc     # Windows
```

## 图标

`src-tauri/icons/` 默认空 (gitignore 了)。要生成 icon:

```bash
# 用 1024x1024 PNG 源生成全套 icon
pnpm tauri icon path/to/source-icon.png
# 自动生成: 32x32.png / 128x128.png / 128x128@2x.png / icon.icns / icon.ico
```

## 架构

```
apps/desktop/                    # Tauri wrapper
├── package.json                 # @tauri-apps/cli + frontend 引用
├── tauri.conf.json              # window / build / icon 配置
├── src-tauri/
│   ├── Cargo.toml               # tauri 2.1 + tauri-plugin-shell
│   ├── build.rs                 # tauri-build
│   ├── src/
│   │   ├── main.rs              # 入口
│   │   └── lib.rs               # 0 行业务, 只起 Tauri runtime
│   ├── icons/                   # 用 pnpm tauri icon 生成
│   └── tauri.conf.json          # 跟根目录同步 (Tauri 2.x 习惯)

apps/web/                        # 实际业务前端 (Vite + React 19)
└── ...
```

**关键设计**:
- `frontendDist: "../web/dist"` — Tauri 打包时嵌 web 的静态构建
- `devUrl: "http://localhost:3000"` — Tauri dev window load vite dev server
- `beforeDevCommand: "pnpm --filter web dev"` — 启 Tauri dev 时先启 vite
- `beforeBuildCommand: "pnpm --filter web build"` — 启 Tauri build 时先 build vite
- `lib.rs` 0 行业务, 只 `tauri::Builder::default().plugin(...).run(tauri::generate_context!())`

## 不动的文件

- `apps/web/*` — 100% 复用, Tauri 不改前端代码
- `deerflow/*` / `agent/*` / `packages/backend/*` — 后端 stack 都不动
- Tauri 是 presentation layer, 只 wrap 现有 web 端

## 下一步 (老板做)

1. **跑 `pnpm tauri icon`** 生成图标
2. **跑 `pnpm tauri dev`** 验证 dev window 起来
3. **跑 `pnpm tauri build`** 验证 release binary
4. **录 5 分钟视频** (用 [docs/demo/demo-script.md](../../docs/demo/demo-script.md))
