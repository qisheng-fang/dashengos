#!/bin/sh
# docker/start-deerflow.sh · v0.3 spec §37.1
# 等 backend 起 socket (最多 30s),再起 Python daemon
set -e

mkdir -p /var/run/dasheng
chown dasheng:dasheng /var/run/dasheng 2>/dev/null || true
chmod 755 /var/run/dasheng

# 等 backend socket/port
echo "[start-deerflow] waiting for backend :8000 ..."
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 8000 2>/dev/null; then
    echo "[start-deerflow] backend ready after ${i}s"
    break
  fi
  sleep 1
done

# 起 Python daemon (v0.3 spec §37.1 嵌入模式)
PYTHON_BIN=/usr/local/bin/deerflow-python
[ ! -x "$PYTHON_BIN" ] && PYTHON_BIN=python3

echo "[start-deerflow] launching daemon ..."
cd /opt/deerflow
exec "$PYTHON_BIN" -m deerflow.daemon
