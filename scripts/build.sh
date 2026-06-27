#!/bin/bash
# DaShengOS v6.0 — Unified Build Script
# Replaces ad-hoc tsc/esbuild. Run: bash scripts/build.sh
set -e
cd "$(dirname "$0")/../packages/backend"

echo "🔨 DaShengOS Build v6.0"
echo "========================"

# Compile all TypeScript modules with esbuild (no-bundle for server, bundle for standalone modules)
FILES=(
  "src/server.ts:dist/server.js"
  "src/api/misc.ts:dist/api/misc.js"
  "src/api/mcp.ts:dist/api/mcp.js"
  "src/api/dashboard.ts:dist/api/dashboard.js"
  "src/api/cloud-runner.ts:dist/api/cloud-runner.js"
  "src/api/health.ts:dist/api/health.js"
  "src/core/policy-engine.ts:dist/core/policy-engine.js"
  "src/core/secret-broker.ts:dist/core/secret-broker.js"
  "src/core/cloud-runner.ts:dist/core/cloud-runner.js"
  "src/core/mcp-client.ts:dist/core/mcp-client.js"
  "src/core/mcp-seed.ts:dist/core/mcp-seed.js"
  "src/core/mcp-path-resolver.ts:dist/core/mcp-path-resolver.js"
  "src/core/auto-backup.ts:dist/core/auto-backup.js"
  "src/core/system-health.ts:dist/core/system-health.js"
  "src/core/pr-workflow.ts:dist/core/pr-workflow.js"
  "src/core/gateway.ts:dist/core/gateway.js"
  "src/storage/db.ts:dist/storage/db.js"
)

for pair in "${FILES[@]}"; do
  src="${pair%%:*}"
  out="${pair##*:}"
  echo "  $(basename $src) → $(basename $out)"
  npx esbuild "$src" --platform=node --target=node20 --format=esm --outfile="$out" 2>/dev/null
done

echo "========================"
echo "✅ Build complete"
