"""
DeerFlowBrain · B 方案 deerflow 后端
====================================

Adapter Boundary 模式 (B 阶段军规, 老板 2026-06-15 拍板):
  - 本文件是 agent/ 目录里**唯一** import deerflow.hermes_adapter 的文件
  - (跟 agent/hermes_brain.py 唯一 import hermes_agent 同构)
  - 禁止 import openai / langchain / hermes_agent / 其他 LLM 库

职责:
  - 把 AgentBrain ABC 适配到 deerflow daemon
  - stream() 把 AG-UI mutation body 转 deerflow JSON-RPC, 翻译 events 字典 → AgentEvent 流
  - 1-shot 模式 (跟 hermes_brain 一致, 跟 CopilotKit 一次性 JSON 响应兼容)

不动:
  - agent/main.py (走 ABC, 不知道 backend 是 hermes 还是 deerflow)
  - apps/web (仍打 :8001)
  - deerflow/hermes_adapter.py (复用现成桥)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any, AsyncIterator

from .brain import (
    AgentBrain,
    AgentEvent,
    AgentEventType,
    Message,
    ThreadState,
    ToolDef,
)

logger = logging.getLogger("agent.deerflow_brain")


class DeerFlowBrain(AgentBrain):
    """把 deerflow daemon 当 LLM/工具后端
    协议: AG-UI mutation → handle_agui_request() (一次性返 events 列表)
    老板原则 #2: 0 行业务逻辑, 薄薄一层 wrapper
    """

    def __init__(self, config: dict | None = None) -> None:
        self.config = config or {}
        self._task_started_at: dict[str, float] = {}  # thread_id → ts (供 health)
        sock = os.environ.get("DEERFLOW_SOCKET_PATH", "/tmp/dasheng/deerflow.sock")
        logger.info("[DeerFlowBrain] init: daemon socket = %s", sock)

    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDef] | None,
        thread_id: str,
        agent_id: str = "default",
        config: dict[str, Any] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """AG-UI mutation → deerflow daemon → events 流

        实际是 1-shot 拉 (adapter 内部 polling 60s), 翻译 events 成 AgentEvent yield
        """
        # 1) 包装 messages 成 AG-UI 期望的 GraphQL mutation body
        agui_messages = [
            {
                "id": m.id,
                "role": m.role.value if hasattr(m.role, "value") else str(m.role),
                "content": m.content,
            }
            for m in messages
        ]
        body = {
            "operationName": "generateCopilotResponse",
            "variables": {"data": {"threadId": thread_id, "messages": agui_messages}},
        }

        # 2) 调 adapter (内部跑 deerflow daemon 全流程: research.run → stream poll → result)
        # 注: 这是 agent/ 唯一 import deerflow.hermes_adapter 的地方
        from deerflow.hermes_adapter import handle_agui_request
        self._task_started_at[thread_id] = time.time()
        logger.info("[DeerFlowBrain.stream] thread=%s, %d messages", thread_id, len(messages))
        result = await handle_agui_request(body)

        # 3) 翻译 events 字典列表 → AgentEvent 流
        for ev in result.get("events", []):
            etype = ev.get("type", "")
            ts = time.time()
            if etype == "RUN_STARTED":
                yield AgentEvent(type=AgentEventType.RUN_STARTED, timestamp=ts)
            elif etype == "STATE_SNAPSHOT":
                yield AgentEvent(
                    type=AgentEventType.STATE_SNAPSHOT,
                    raw=ev.get("state", {}),
                    timestamp=ts,
                )
            elif etype == "MESSAGES_SNAPSHOT":
                # 提取最后 1 条 assistant 消息当 TEXT_DELTA (urql join 后是完整文本)
                msgs = ev.get("messages", [])
                assistant = next((m for m in reversed(msgs) if m.get("role") == "assistant"), None)
                if assistant and assistant.get("content"):
                    yield AgentEvent(
                        type=AgentEventType.TEXT_DELTA,
                        delta=assistant["content"],
                        message_id=assistant.get("id"),
                        timestamp=ts,
                    )
            elif etype == "RUN_FINISHED":
                yield AgentEvent(
                    type=AgentEventType.RUN_FINISHED,
                    raw={"outcome": ev.get("outcome", "success")},
                    timestamp=ts,
                )
            elif etype == "RUN_ERROR":
                yield AgentEvent(
                    type=AgentEventType.RUN_ERROR,
                    error=ev.get("message", "unknown"),
                    timestamp=ts,
                )
            # UNKNOWN / 其他 event 静默跳过

        # 清理 thread tracking
        self._task_started_at.pop(thread_id, None)

    def list_tools(self, agent_id: str = "default") -> list[ToolDef]:
        """deerflow 工具链 (web_search/browser/file_read/sandbox_exec) 不暴露给 AG-UI 工具选择
        Lead agent 在 daemon 内部自调度, 跟 hermes_brain 行为一致
        """
        return []

    def get_state(self, thread_id: str) -> ThreadState:
        """deerflow daemon 不持久化 thread 状态, 返空 state
        前端会 fallback 到 localStorage 缓存 (per agent-client.ts 设计)
        """
        return ThreadState(thread_id=thread_id, messages=[])

    def cancel(self, thread_id: str) -> bool:
        """取消正在跑的 deerflow 任务
        adapter 用 thread_id 当 task_id (hermes_adapter.py:190), 直接调 daemon research.cancel
        """
        try:
            from deerflow.hermes_adapter import DeerFlowClient

            async def _do_cancel() -> bool:
                async with DeerFlowClient(timeout=5.0) as client:
                    resp = await client.request("research.cancel", {"taskId": thread_id})
                    return resp.get("result", {}).get("status") == "cancelled"

            return asyncio.run(_do_cancel())
        except Exception as e:
            logger.warning("[DeerFlowBrain] cancel %s failed: %s", thread_id, e)
            return False

    def health(self) -> dict[str, Any]:
        """健康检查: 检 daemon socket + 列已跟踪的 thread 数"""
        sock = os.environ.get("DEERFLOW_SOCKET_PATH", "/tmp/dasheng/deerflow.sock")
        daemon_alive = Path(sock).exists()
        return {
            "backend": "deerflow",
            "version": "0.1.0",
            "daemon_socket": sock,
            "daemon_connected": daemon_alive,
            "active_threads": len(self._task_started_at),
        }
