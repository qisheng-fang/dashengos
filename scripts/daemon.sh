#!/bin/bash
# DaShengOS 守护进程管理 — launchd 注册/启停/状态
set -e

WORKSPACE="/Users/apple/Desktop/ai-workbench-v2"
BACKEND_DIR="$WORKSPACE/packages/backend"
FRONTEND_DIR="$WORKSPACE/apps/web"
LOG_DIR="$HOME/Library/Logs/DaShengOS"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"

mkdir -p "$LOG_DIR" "$LAUNCHD_DIR"

# ── 前端 plist ──
cat > "$LAUNCHD_DIR/com.dasheng.frontend.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dasheng.frontend</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>FRONTEND_DIR_PLACEHOLDER/node_modules/.bin/vite</string>
        <string>--host</string>
        <string>127.0.0.1</string>
        <string>--port</string>
        <string>3000</string>
    </array>
    <key>WorkingDirectory</key>
    <string>FRONTEND_DIR_PLACEHOLDER</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>Crashed</key>
        <true/>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>3</integer>
    <key>StandardOutPath</key>
    <string>LOG_DIR_PLACEHOLDER/frontend.log</string>
    <key>StandardErrorPath</key>
    <string>LOG_DIR_PLACEHOLDER/frontend-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string>HOME_PLACEHOLDER</string>
    </dict>
</dict>
</plist>
PLIST

# ── 后端 plist ──
cat > "$LAUNCHD_DIR/com.dasheng.backend.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dasheng.backend</string>
    <key>ProgramArguments</key>
    <array>
        <string>NODE_BIN_PLACEHOLDER</string>
        <string>--require</string>
        <string>BACKEND_DIR_PLACEHOLDER/node_modules/tsx/dist/preflight.cjs</string>
        <string>--import</string>
        <string>file://BACKEND_DIR_PLACEHOLDER/node_modules/tsx/dist/loader.mjs</string>
        <string>BACKEND_DIR_PLACEHOLDER/src/server.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>BACKEND_DIR_PLACEHOLDER</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>Crashed</key>
        <true/>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>LOG_DIR_PLACEHOLDER/backend.log</string>
    <key>StandardErrorPath</key>
    <string>LOG_DIR_PLACEHOLDER/backend-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$(brew --prefix node@24 2>/dev/null || echo /usr/local/opt/node@24)/bin</string>
        <key>HOME</key>
        <string>HOME_PLACEHOLDER</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
PLIST

# ── 替换占位符 ──
NODE_BIN=$(which node 2>/dev/null || echo "/usr/local/Homebrew/Cellar/node@24/24.17.0/bin/node")

for f in "$LAUNCHD_DIR/com.dasheng.frontend.plist" "$LAUNCHD_DIR/com.dasheng.backend.plist"; do
  sed -i '' "s|BACKEND_DIR_PLACEHOLDER|$BACKEND_DIR|g" "$f"
  sed -i '' "s|FRONTEND_DIR_PLACEHOLDER|$FRONTEND_DIR|g" "$f"
  sed -i '' "s|LOG_DIR_PLACEHOLDER|$LOG_DIR|g" "$f"
  sed -i '' "s|HOME_PLACEHOLDER|$HOME|g" "$f"
  sed -i '' "s|NODE_BIN_PLACEHOLDER|$NODE_BIN|g" "$f"
done

echo "✅ plist 文件已生成"
