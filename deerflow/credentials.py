#!/usr/bin/env python3
# deerflow/credentials.py · v0.3 spec §35.6
# Keychain 凭据读取
# 老板原则 #2: 0 行业务逻辑,薄薄一层 secrets 注入
#
# 真生产: 通过 JSON-RPC 调 backend secret.read (统一审计)
# dev:    直接读 ~/.workbuddy/credentials/*.env

import os
from pathlib import Path
from typing import Optional

CREDENTIALS_DIR = Path(os.environ.get(
    "DASHENG_CREDENTIALS_DIR",
    os.path.expanduser("~/.workbuddy/credentials"),
))


def get_secret(name: str) -> Optional[str]:
    """读 Keychain 凭据 (spec §35.6)
    真生产走 JSON-RPC secret.read → backend → 审计
    dev 直接读文件系统
    """
    if os.environ.get("DEERFLOW_USE_BACKEND_SECRETS", "false").lower() == "true":
        import asyncio
        from deerflow.daemon import secret_read  # type: ignore
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        result = loop.run_until_complete(secret_read({"name": name}))
        return result.get("value") if isinstance(result, dict) else None

    # dev fallback: 直接读文件
    p = CREDENTIALS_DIR / f"{name}.env"
    if p.exists():
        return p.read_text().strip()
    return None


def list_secrets() -> list[str]:
    """列所有 Keychain 凭据名 (spec §35.4 secret.list)"""
    if not CREDENTIALS_DIR.exists():
        return []
    return [p.stem for p in CREDENTIALS_DIR.glob("*.env")]


def init_env() -> int:
    """启动时把凭据注入到 os.environ (供 LLM client 用)
    老板原则 #5: 不写死,启动时从 keychain 读
    返: 注入的 secret 数量 (不覆盖已存在的 env var)
    """
    n = 0
    for name in list_secrets():
        value = get_secret(name)
        if value and name not in os.environ:
            os.environ[name] = value
            n += 1
    return n
