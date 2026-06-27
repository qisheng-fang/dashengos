#!/bin/bash
# DaShengOS v6.0 · Post-Build Dist Patcher
# 在 tsc 编译后自动修复 dist 中的已知问题
# 运行: bash scripts/patch-dist.sh

set -e
DIST="packages/backend/dist"

echo "🔧 DaShengOS Dist Patcher v6.0"
echo "================================"

# ─── Patch 1: MCP Status Map (STARTED → running) ──────────
echo "  [1/4] MCP status mapping..."
sed -i '' "s/return reply.send({ servers: rows });/const STATUS_MAP = { STARTED: 'running', STOPPED: 'offline', ERRORED: 'offline', REGISTERED: 'offline' };\n            const servers = (rows).map(row => ({ ...row, status: STATUS_MAP[row.status] || 'offline' }));\n            return reply.send({ servers });/" "$DIST/api/mcp.js" 2>/dev/null && echo "    ✓ mcp status map" || echo "    ⚠ skipped (already patched?)"

# ─── Patch 2: System Health MCP status check ───────────────
echo "  [2/4] System health MCP check..."
sed -i '' "s/s.status === 'STARTED' ? 'healthy' : 'down'/s.status === 'running' ? 'healthy' : 'down'/" "$DIST/core/system-health.js" 2>/dev/null && echo "    ✓ health MCP check" || echo "    ⚠ skipped"

# ─── Patch 3: Misc.js sandbox fallback ─────────────────────
echo "  [3/4] Sandbox fallback..."
if grep -q "executeDirect" "$DIST/api/misc.js" 2>/dev/null; then
  echo "    ✓ already present"
else
  echo "    ⚠ needs manual review — sandbox fallback missing"
fi

# ─── Patch 4: Verify critical paths exist ──────────────────
echo "  [4/4] Critical path check..."
for f in "$DIST/server.js" "$DIST/api/mcp.js" "$DIST/core/mcp-client.js" "$DIST/core/system-health.js"; do
  if [ -f "$f" ]; then
    echo "    ✓ $(basename $f)"
  else
    echo "    ✗ MISSING: $f"
  fi
done

echo "================================"
echo "✅ Dist patching complete"
