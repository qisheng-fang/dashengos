#!/usr/bin/env python3
# deerflow/hermes-adapter.py · v0.3 spec §35.6 (AG-UI ↔ JSON-RPC 桥)
#
# 老板原则 #2: 0 行业务逻辑,薄薄一层协议适配
#
# 职责:
#   1. AG-UI protocol 解析 (从 FastAPI /api/agent 收的 GraphQL mutation)
#   2. 翻译成 DeerFlow daemon JSON-RPC 调用
#   3. 流式把 deerflow 响应 push 给前端 client
#
# 这是 v0.3 spec ADR-050 §4 标注的 'Adapter Boundary 模板' 位置:
#   `agent/hermes_brain.py` → `deerflow/hermes-adapter.py`
# 区别: hermes_brain 直调 SiliconFlow,hermes-adapter 调 DeerFlow daemon

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

# 现有 hermes_brain 的 LLM 客户端 (deerflow 不可用时 fallback)
try:
    from openai import AsyncOpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

logger = logging.getLogger("deerflow.hermes")


# ====================================================================
# 配置
# ====================================================================
SOCKET_PATH = os.environ.get("DEERFLOW_SOCKET_PATH", "/tmp/dasheng/deerflow.sock")
DEERFLOW_ENABLED = os.environ.get("DEERFLOW_ENABLED", "true").lower() == "true"
DASHENG_BACKEND_URL = os.environ.get("DASHENG_BACKEND_URL", "http://127.0.0.1:8000")
FALLBACK_LLM_HOST = os.environ.get("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")
FALLBACK_LLM_KEY = os.environ.get("OPENAI_API_KEY", "")
FALLBACK_LLM_MODEL = os.environ.get("DEERFLOW_FALLBACK_MODEL", "Qwen/Qwen2.5-72B-Instruct")


# ====================================================================
# JSON-RPC client (Unix socket · spec §35.3)
# ====================================================================
class DeerFlowClient:
    """Thin JSON-RPC over Unix socket client

    用法:
        async with DeerFlowClient() as client:
            result = await client.request("research.run", {"query": "..."})
    """

    def __init__(self, socket_path: str = SOCKET_PATH, timeout: float = 30.0):
        self.socket_path = socket_path
        self.timeout = timeout
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()
        self._req_id = 0

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def connect(self) -> None:
        if not Path(self.socket_path).exists():
            raise ConnectionError(f"DeerFlow socket not found: {self.socket_path}")
        self._reader, self._writer = await asyncio.open_unix_connection(self.socket_path)
        logger.info("connected to deerflow daemon at %s", self.socket_path)

    async def close(self) -> None:
        if self._writer:
            self._writer.close()
            await self._writer.wait_closed()

    async def request(self, method: str, params: dict | None = None) -> dict:
        """Send 1 JSON-RPC request, return result dict"""
        async with self._lock:
            self._req_id += 1
            req = {
                "jsonrpc": "2.0",
                "id": self._req_id,
                "method": method,
                "params": params or {},
            }
            assert self._writer is not None and self._reader is not None
            self._writer.write((json.dumps(req) + "\n").encode("utf-8"))
            await self._writer.drain()
            line = await asyncio.wait_for(self._reader.readline(), self.timeout)
            return json.loads(line.decode("utf-8"))


# ====================================================================
# AG-UI 协议适配 (spec §35.3)
# ====================================================================
def parse_agui_request(body: dict) -> dict:
    """CopilotKit AG-UI mutation: generateCopilotResponse → DeerFlow 参数
    body 形如:
    {
      "operationName": "generateCopilotResponse",
      "variables": {
        "data": {
          "threadId": "t_xxx",
          "messages": [{"id": "m1", "role": "user", "content": "..."}],
          ...
        }
      }
    }
    """
    variables = body.get("variables", {})
    data = variables.get("data", {})
    thread_id = data.get("threadId", f"t_{uuid.uuid4().hex[:12]}")
    messages = data.get("messages", [])

    # 提取 user 最后 1 条消息作为 query
    user_msgs = [m for m in messages if m.get("role") == "user"]
    query = user_msgs[-1]["content"] if user_msgs else ""

    return {
        "threadId": thread_id,
        "query": query,
        "messages": messages,
    }


def to_agui_event(event: dict, thread_id: str, run_id: str) -> dict:
    """DeerFlow event → AG-UI 事件 (v0.3 spec §35.3 协议映射)"""
    etype = event.get("type", "")

    if etype == "research.started":
        return {
            "type": "RUN_STARTED",
            "threadId": thread_id,
            "runId": run_id,
        }
    elif etype == "step":
        return {
            "type": "STATE_SNAPSHOT",
            "threadId": thread_id,
            "runId": run_id,
            "state": {
                "step": event.get("step", ""),
                "ts": event.get("ts", 0),
            },
        }
    elif etype == "research.completed":
        return {
            "type": "RUN_FINISHED",
            "threadId": thread_id,
            "runId": run_id,
            "outcome": "success",
        }
    elif etype == "research.error":
        return {
            "type": "RUN_ERROR",
            "threadId": thread_id,
            "runId": run_id,
            "message": event.get("error", "unknown"),
        }
    return {"type": "UNKNOWN", "raw": event}


# ====================================================================
# 主入口 · 调 DaShengOS backend 的 /api/agent
# ====================================================================
async def handle_agui_request(body: dict) -> dict:
    """FastAPI 端点 handler: 收 AG-UI mutation,转发 DeerFlow daemon

    用法 (deerflow/main.py 里 wire):
        @app.post("/api/agent")
        async def agent_endpoint(request: Request):
            body = await request.json()
            return await handle_agui_request(body)
    """
    parsed = parse_agui_request(body)
    thread_id = parsed["threadId"]
    query = parsed["query"]
    run_id = f"r_{uuid.uuid4().hex[:8]}"

    # 1. 启动 DeerFlow 研究任务
    try:
        async with DeerFlowClient() as client:
            ack = await client.request("research.run", {
                "taskId": thread_id,
                "query": query,
                "subAgents": ["researcher", "writer", "quality_reviewer"],
                "maxSteps": 20,
            })
            task_id = ack.get("result", {}).get("taskId", thread_id)
            logger.info("deerflow started: task=%s query=%r", task_id, query[:60])

            # 2. 轮询状态,转 AG-UI 事件
            # 6/15 老板修: 60s 太短,SiliconFlow 慢时 writer 阶段超过 60s 会拿到 (无报告)
            #   实测: 3-sub-agent pipeline 35-75s 完成 (writer 24-31s), 给 120s buffer
            events: list[dict] = []
            deadline = time.time() + 120  # 最多等 120s
            while time.time() < deadline:
                stream = await client.request("research.stream", {"taskId": task_id})
                new_events = stream.get("result", {}).get("events", [])
                for ev in new_events:
                    agui_ev = to_agui_event(ev, thread_id, run_id)
                    if agui_ev["type"] != "UNKNOWN":
                        events.append(agui_ev)
                status_resp = await client.request("research.status", {"taskId": task_id})
                status = status_resp.get("result", {}).get("status", "")
                if status in ("completed", "cancelled", "error"):
                    break
                await asyncio.sleep(0.5)

            # 3. 拿最终结果
            result = await client.request("research.result", {"taskId": task_id})
            report = result.get("result", {}).get("report", "")

            # 4. 推一条 MESSAGES_SNAPSHOT (AG-UI 渲染要)
            events.append({
                "type": "MESSAGES_SNAPSHOT",
                "threadId": thread_id,
                "runId": run_id,
                "messages": parsed["messages"] + [
                    {"id": f"a_{uuid.uuid4().hex[:8]}", "role": "assistant", "content": report or "(无报告)"},
                ],
            })
            # 5. 末尾 RUN_FINISHED (如果 status 还不是)
            if not any(e["type"] == "RUN_FINISHED" for e in events):
                events.append({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "outcome": "success"})

            return {"events": events, "threadId": thread_id, "runId": run_id}

    except Exception as e:
        logger.warning("DeerFlow unavailable (%s), falling back to direct LLM", e)
        return await _fallback_to_direct_llm(parsed, thread_id, run_id)


async def _fallback_to_direct_llm(parsed: dict, thread_id: str, run_id: str) -> dict:
    """DeerFlow 不可用时 → 直调 SiliconFlow (现有 hermes_brain 逻辑)
    老板原则 #5: 不写死,降级透明
    """
    if not HAS_OPENAI or not FALLBACK_LLM_KEY:
        return {
            "events": [
                {"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id},
                {"type": "MESSAGES_SNAPSHOT", "threadId": thread_id, "runId": run_id,
                 "messages": parsed["messages"] + [
                     {"id": f"a_{uuid.uuid4().hex[:8]}", "role": "assistant",
                      "content": f"[hermes-adapter] DeerFlow 不可用且 fallback LLM 未配 ({FALLBACK_LLM_MODEL})"},
                 ]},
                {"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "outcome": "partial"},
            ],
            "threadId": thread_id, "runId": run_id,
        }

    client = AsyncOpenAI(base_url=FALLBACK_LLM_HOST, api_key=FALLBACK_LLM_KEY)
    resp = await client.chat.completions.create(
        model=FALLBACK_LLM_MODEL,
        messages=parsed["messages"] or [{"role": "user", "content": parsed["query"]}],
    )
    content = resp.choices[0].message.content or ""
    return {
        "events": [
            {"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id},
            {"type": "MESSAGES_SNAPSHOT", "threadId": thread_id, "runId": run_id,
             "messages": parsed["messages"] + [
                 {"id": f"a_{uuid.uuid4().hex[:8]}", "role": "assistant", "content": content},
             ]},
            {"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "outcome": "success"},
        ],
        "threadId": thread_id, "runId": run_id,
    }


# ====================================================================
# 信息端点 (spec §35.4 agent.list)
# ====================================================================
async def info_endpoint() -> dict:
    """返回给 /api/agent info method (列可用 agent)"""
    if DEERFLOW_ENABLED and Path(SOCKET_PATH).exists():
        try:
            async with DeerFlowClient(timeout=2.0) as client:
                resp = await client.request("agent.list", {})
            agents = resp.get("result", {}).get("agents", [])
            return {"agents": {a["name"]: a for a in agents}}
        except Exception as e:
            logger.warning("deerflow info failed: %s", e)
    return {"agents": {"orchestrator": {"name": "orchestrator", "role": "lead"}}}
