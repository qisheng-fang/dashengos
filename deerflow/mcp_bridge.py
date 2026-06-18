#!/usr/bin/env python3
# deerflow/mcp_bridge.py · v0.3 spec §35.5
# DeerFlow 作 MCP client 调 DaShengOS MCP servers
# 老板原则 #2: 0 行业务逻辑,薄薄一层协议桥

import asyncio
import json
import logging
import os
from typing import Any

logger = logging.getLogger("deerflow.mcp_bridge")


async def get_dasheng_mcp_servers() -> list[dict]:
    """从 DaShengOS backend 拉 MCP servers (spec §35.5)
    真实生产: http://127.0.0.1:8000/api/v1/mcp/servers
    """
    import urllib.request
    backend = os.environ.get("DASHENG_BACKEND_URL", "http://127.0.0.1:8000")
    try:
        with urllib.request.urlopen(f"{backend}/api/v1/mcp/servers", timeout=5) as resp:
            data = json.loads(resp.read().decode())
        return data.get("servers", [])
    except Exception as e:
        logger.warning("failed to fetch MCP servers: %s", e)
        return []


async def connect_mcp_server(server: dict) -> Any:
    """连接单个 MCP server (Phase 3 简化: 返回 None stub)"""
    logger.info("would connect to MCP server: %s (%s)", server.get("id"), server.get("command"))
    # 真生产用 stdio_client spawn server, 初始化 MCP session
    return None
