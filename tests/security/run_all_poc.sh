#!/bin/bash
# tests/security/run_all_poc.sh · v0.3 Phase 4 hardening
# 4 PoC 串行 orchestrator, 任意失败立刻 exit 1
#
# 跑前: 必须在 sandbox 内 (用 sandbox-exec IPC 或本地 subreaper)
# 用法: ./tests/security/run_all_poc.sh
#
# 输出: 每个 PoC 一段, 最后 PASS/FAIL 总览
#   ✅ PoC N PASS: ...
#   ❌ PoC N FAIL: ...
#   ⚠️  PoC N SKIP: ...
#
# 退出码: 0 = 全部 PASS, 1 = 有 FAIL (BYPASS!)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POCS=(
  "poc_01_seccomp_ptrace.sh"
  "poc_02_seccomp_mount.sh"
  "poc_03_cgroup_memlimit.sh"
  "poc_04_fs_isolation.sh"
)

PASS=0
FAIL=0
SKIP=0
RESULTS=()

echo "=========================================="
echo "DaShengOS v0.3 Phase 4 hardening · 4 PoC"
echo "=========================================="
echo

for poc in "${POCS[@]}"; do
  echo "=== $poc ==="
  # 不让 set -e 中断, 单独捕获每个 PoC 的退出码
  set +e
  OUTPUT=$(bash "$SCRIPT_DIR/$poc" 2>&1)
  POC_EXIT=$?
  set -e
  echo "$OUTPUT"
  if [ "$POC_EXIT" -eq 0 ]; then
    if echo "$OUTPUT" | grep -q "SKIP"; then
      SKIP=$((SKIP+1))
      RESULTS+=("SKIP $poc")
    else
      PASS=$((PASS+1))
      RESULTS+=("PASS $poc")
    fi
  else
    FAIL=$((FAIL+1))
    RESULTS+=("FAIL $poc")
  fi
  echo
done

echo "=========================================="
echo "Results:"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo
echo "PASS: $PASS"
echo "SKIP: $SKIP"
echo "FAIL: $FAIL"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  echo "❌ PoC suite FAIL: 有 ${FAIL} 个安全控制被 bypass"
  exit 1
fi
echo "✅ PoC suite OK: 没有 bypass, ${SKIP} 个 SKIP (需在 sandbox 内跑)"
exit 0
