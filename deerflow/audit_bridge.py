#!/usr/bin/env python3
# deerflow/audit_bridge.py · v0.3 spec §37.3
# LangFuse 兼容 → DaShengOS 审计同步
# 老板原则 #2: 0 行业务逻辑,薄薄一层事件 hook

import logging
import os
from typing import Any
from datetime import datetime

logger = logging.getLogger("deerflow.audit_bridge")


class AuditBridge:
    """把 LangFuse event 转成 DaShengOS audit 格式,通过 daemon 的 audit.write 上报

    用法 (在 lead_agent.py 里):
        bridge = AuditBridge()
        bridge.emit({"level": "info", "type": "deerflow.tool_call", "tool": "...", ...})
    """

    def __init__(self):
        self.enabled = os.environ.get("DEERFLOW_TRACE_SYNC_ENABLED", "true").lower() == "true"

    def emit(self, event: dict[str, Any]) -> None:
        """fire-and-forget 同步事件,失败不阻断主流程"""
        if not self.enabled:
            return
        try:
            # 已在 daemon.py 的 audit.write 里做了 level/type 映射,这里只调
            from deerflow.daemon import audit_write  # late import 防循环
            import asyncio
            level = self._map_level(event.get("level", "info"))
            typ = self._map_type(event)
            payload = {
                "level": level,
                "type": typ,
                "source": "deerflow",
                "ts": int(datetime.utcnow().timestamp() * 1000),
                **event,
            }
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            loop.create_task(audit_write(payload))
        except Exception as e:
            logger.warning("audit_bridge emit failed (non-fatal): %s", e)

    def _map_level(self, level: str) -> str:
        return {"debug": "DEBUG", "info": "INFO", "warning": "WARN", "error": "ERROR"}.get(level, "INFO")

    def _map_type(self, event: dict) -> str:
        et = event.get("type", "")
        if "tool" in et:
            return "deerflow.tool_call"
        if "llm" in et:
            return "deerflow.llm_call"
        if "sub_agent" in et and "start" in et:
            return "deerflow.subagent_start"
        if "sub_agent" in et and "end" in et:
            return "deerflow.subagent_end"
        return "deerflow.event"


# 全局单例
bridge = AuditBridge()


def emit(event: dict[str, Any]) -> None:
    """shortcut for bridge.emit"""
    bridge.emit(event)
