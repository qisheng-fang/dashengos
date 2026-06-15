#!/bin/bash
# tests/security/poc_01_seccomp_ptrace.sh · v0.3 Phase 4 hardening
# PoC 1: 验证 BPF seccomp 阻止 ptrace (sandbox/internal/security/seccomp_linux.go)
#
# 约定: 危险操作被阻止 → 返 0 (安全 OK), 成功 → 返 1 (BYPASS! 失效)
# 跑法: 必须在 sandbox 内 (sandbox-exec IPC 或本地 subreaper), 否则是 N/A
#   在 host 上跑这个脚本会返 0, 因为 host 没启用 seccomp (PoC 没意义但不报错)

set -e

# 用 python ctypes 直接 syscall ptrace
RESULT=$(python3 -c "
import ctypes, sys
libc = ctypes.CDLL('libc.so.6', use_errno=True)
PTRACE_TRACEME = 0
ret = libc.ptrace(PTRACE_TRACEME, 0, 0, 0)
if ret == 0:
    print('BYPASS')
    sys.exit(0)
else:
    errno = ctypes.get_errno()
    print(f'OK ret={ret} errno={errno}')
    sys.exit(1)
" 2>&1) || EXITCODE=$?
EXITCODE=${EXITCODE:-0}

if echo "$RESULT" | grep -q "BYPASS"; then
    echo "❌ PoC 1 FAIL: $RESULT"
    echo "   seccomp 失效, ptrace 居然成功了"
    exit 1
elif [ "$EXITCODE" -eq 137 ] || [ "$EXITCODE" -eq 134 ]; then
    # KILL_PROCESS (137=SIGKILL) 或 SIGABRT (134)
    echo "✅ PoC 1 PASS: ptrace 被 seccomp KILL (exit=$EXITCODE, $RESULT)"
    exit 0
elif [ "$EXITCODE" -ne 0 ]; then
    # ptrace 返非 0, errno 非 0 (EPERM=1 通常)
    echo "✅ PoC 1 PASS: ptrace 被拒绝 (exit=$EXITCODE, $RESULT)"
    exit 0
else
    echo "⚠️  PoC 1 SKIP: ptrace 居然成功了 — 可能在 host 上跑 (没启用 seccomp)"
    echo "   真正测要在 sandbox 内执行. Result: $RESULT"
    exit 0
fi
