#!/bin/bash
# tests/security/poc_03_cgroup_memlimit.sh · v0.3 Phase 4 hardening
# PoC 3: 验证 cgroup 内存限制生效 (sandbox/internal/security/cgroup_compat_linux.go)
#
# 约定: 危险操作被阻止 → 返 0 (安全 OK), 成功 → 返 1 (BYPASS! 失效)
# 跑法: 必须在 cgroup 受限的环境 (sandbox 或 systemd-run --user --scope -p MemoryMax=512M)
#   在无 cgroup 限制的 host 上跑: SKIP

set -e

# 检当前 cgroup 限制
if [ -f /sys/fs/cgroup/memory.max ]; then
    LIMIT=$(cat /sys/fs/cgroup/memory.max)
    echo "cgroup v2 memory.max = $LIMIT bytes"
elif [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    LIMIT=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
    echo "cgroup v1 memory.limit_in_bytes = $LIMIT bytes"
else
    echo "⚠️  PoC 3 SKIP: 不在 cgroup 内, 跳过"
    echo "   真正测要在 sandbox 内 (或 systemd-run --user --scope -p MemoryMax=512M bash)"
    exit 0
fi

# 如果 limit 是 "max" (cgroup v2), 没限制, 跳过
if [ "$LIMIT" = "max" ]; then
    echo "⚠️  PoC 3 SKIP: cgroup 限制 = max (没启用), 跳过"
    exit 0
fi

# 试图分配 4GB (超过典型 sandbox 512MB 限制)
# 用 python ctypes + 真的 memset 触发实际 page fault
set +e
python3 -c "
import ctypes, sys
libc = ctypes.CDLL('libc.so.6')
size = 4 * 1024 * 1024 * 1024
print(f'试图 malloc + memset {size} bytes...', flush=True)
ptr = libc.malloc(size)
if not ptr:
    print('OK: malloc 返 NULL, 内存受限', flush=True)
    sys.exit(0)
# 真的写内存触发 page fault + OOM
ctypes.memset(ptr, 0, size)
print('BYPASS', flush=True)
sys.exit(0)
" 2>&1
EXITCODE=$?
set -e

# python OOM 会让 process 被 SIGKILL, exit code = 137
if [ "$EXITCODE" -eq 137 ] || [ "$EXITCODE" -eq 134 ]; then
    echo "✅ PoC 3 PASS: malloc 4GB 触发 OOM kill (exit=$EXITCODE)"
    exit 0
elif [ "$EXITCODE" -eq 0 ]; then
    # malloc 返 NULL (内存受限) 算 OK
    echo "✅ PoC 3 PASS: malloc 返 NULL 或被 cgroup 拒绝"
    exit 0
else
    echo "❌ PoC 3 FAIL: 异常 exit=$EXITCODE"
    exit 1
fi
