#!/bin/bash
# tests/security/poc_04_fs_isolation.sh · v0.3 Phase 4 hardening
# PoC 4: 验证 fs namespace 隔离 /etc/shadow (新 pid/mount namespace 不应看到 host 敏感文件)
#
# 约定: 危险操作被阻止 → 返 0 (安全 OK), 成功 → 返 1 (BYPASS! 失效)

set -e

# 试图读 /etc/shadow → 应 Permission denied (root 隔离) 或 No such file (无 root 权限)
if [ ! -e /etc/shadow ]; then
    # 文件不存在 — 在隔离的 rootfs 里 (e.g. alpine minimal image)
    echo "✅ PoC 4 PASS: /etc/shadow 不存在 (在隔离的 rootfs 里)"
    exit 0
fi

# 文件存在 — 试着读
set +e
CONTENT=$(cat /etc/shadow 2>&1)
EXITCODE=$?
set -e

if [ "$EXITCODE" -eq 0 ] && echo "$CONTENT" | grep -q ":"; then
    # 成功读到了真内容 (含 : 分隔的 hash 行) — fs 隔离失效
    echo "❌ PoC 4 FAIL: /etc/shadow 居然能读"
    echo "   内容前 80 字符: ${CONTENT:0:80}"
    echo "   fs 隔离失效!"
    exit 1
else
    echo "✅ PoC 4 PASS: /etc/shadow 不可读 (exit=$EXITCODE, ${CONTENT:0:80})"
    exit 0
fi
