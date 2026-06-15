#!/bin/bash
# tests/security/poc_02_seccomp_mount.sh · v0.3 Phase 4 hardening
# PoC 2: 验证 BPF seccomp 阻止 mount (mount 不在 allowlist 中, 应被 KILL)
#
# 约定: 危险操作被阻止 → 返 0 (安全 OK), 成功 → 返 1 (BYPASS! 失效)
# 跑法: 必须在 sandbox 内 (sandbox-exec IPC 或本地 subreaper)

set -e

mkdir -p /tmp/poc_mount_target 2>/dev/null || true
trap 'rmdir /tmp/poc_mount_target 2>/dev/null || true' EXIT

# 试图 mount tmpfs → 应被 seccomp KILL (返 137) 或 EPERM (返 32)
# 用 `|| EXITCODE=$?` 捕获退出码, set -e 会让非 0 退出但我们想看
set +e
mount -t tmpfs none /tmp/poc_mount_target 2>/dev/null
EXITCODE=$?
set -e

# 检结果
if [ "$EXITCODE" -eq 0 ]; then
    # mount 成功 — 尝试 unmount
    umount /tmp/poc_mount_target 2>/dev/null || true
    echo "❌ PoC 2 FAIL: mount 居然成功了 (exit=0)"
    echo "   seccomp 失效, allowlist 漏掉了 mount syscall"
    exit 1
elif [ "$EXITCODE" -eq 137 ] || [ "$EXITCODE" -eq 134 ]; then
    # KILL_PROCESS (137=SIGKILL) 或 SIGABRT (134) — seccomp 直接杀进程
    echo "✅ PoC 2 PASS: mount 被 seccomp KILL (exit=$EXITCODE)"
    exit 0
elif [ "$EXITCODE" -ne 0 ]; then
    # 任何非 0 退出 (EPERM=32, EACCES=13, ENOSYS=38 等)
    echo "✅ PoC 2 PASS: mount 被拒绝 (exit=$EXITCODE)"
    exit 0
else
    echo "⚠️  PoC 2 SKIP: 异常 exit=$EXITCODE"
    exit 0
fi
