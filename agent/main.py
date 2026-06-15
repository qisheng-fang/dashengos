"""
Dasheng 大师 OS · Agent Bridge · FastAPI 入口
==============================================

老板 2026-06-15 拍板的 B 方案:
  Frontend :3000 (Next.js + CopilotKit, 不动)
    │ AG-UI 协议 (CopilotKit 标准)
    ▼
  本服务 :8001 (FastAPI + 我们自己的 brain ABC + hermes 实现)

路由:
  POST /api/agent            AG-UI 协议 (一次性 JSON 响应, GraphQL 兼容)
  GET  /api/agent            405
  GET  /health               健康检查 (liveness + readiness)
  GET  /tools                列出可用工具 (debug)
  GET  /threads/{id}         取线程状态
  POST /threads/{id}/cancel  取消正在跑的线程

历史: 6/15 之前路由叫 /api/copilotkit, 老板拍板改名为 /api/agent
      (协议是 AG-UI, 不是 CopilotKit, 路径不再含 copilotkit 字样)

启动:
  cd /Users/apple/Desktop/ai-workbench-v2
  source agent/.venv/bin/activate  # 或 uv run
  python -m agent.main
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .brain import AgentEvent, AgentEventType, Message, MessageRole, ToolName
from .brain_factory import create_brain, list_backends
from .config import AgentConfig

logger = logging.getLogger(__name__)


# ─── 全局 ──────────────────────────────────────────────────────────────
_config: AgentConfig | None = None
_brain = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """启动时初始化 brain, 关闭时清理"""
    global _config, _brain
    _config = AgentConfig.from_env()
    logging.basicConfig(
        level=logging.DEBUG if _config.debug else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info(
        f"[main] 启动 · backend={_config.brain_backend} · model={_config.model} · "
        f"port={_config.port} · health_port={_config.health_port}"
    )
    _brain = create_brain(backend=_config.brain_backend, config=_config.to_brain_config())
    yield
    logger.info("[main] 关闭")


app = FastAPI(
    title="Dasheng Agent Bridge",
    version="0.1.0-b1",
    lifespan=lifespan,
)


# ─── CORS (开发期宽松, 上线收紧) ───────────────────────────────────────
# ⚠️ 老板 2026-06-15 拍板修: 必须 module load 时注册, 不能懒加载
#    之前 _setup_cors() 在 main() 才跑, 但 main() 调 uvicorn.run() 之前还有 lifespan 初始化,
#    OPTIONS 预检请求到达时 CORS middleware 还没生效 → 浏览器 405 拒绝
def _build_cors_origins() -> list[str]:
    """从环境变量读 CORS 白名单, 立刻可用 (不等 lifespan)"""
    return [o.strip() for o in os.environ.get("DASHENG_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]


# ⚠️ module import 时立即注册 — 这条对浏览器 AG-UI 协议 OPTIONS 预检至关重要
app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # AG-UI 协议需要暴露 thread-id 给前端
    expose_headers=["*"],
)


# ─── 健康检查 ──────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, Any]:
    if not _brain:
        return {"status": "starting"}
    brain_health = _brain.health()
    return {
        "status": "ok",
        "service": "dasheng-agent-bridge",
        "version": "0.1.0-b1",
        "config": {
            "backend": _config.brain_backend if _config else "?",
            "model": _config.model if _config else "?",
            "port": _config.port if _config else "?",
        },
        "brain": brain_health,
        "available_backends": list_backends(),
    }


# ─── 工具列表 ──────────────────────────────────────────────────────────
@app.get("/tools")
async def list_tools(agent_id: str = "default") -> dict[str, Any]:
    if not _brain:
        raise HTTPException(503, "brain not initialized")
    return {
        "agent_id": agent_id,
        "tools": [t.model_dump() for t in _brain.list_tools(agent_id)],
    }


# ─── 线程状态 ──────────────────────────────────────────────────────────
@app.get("/threads/{thread_id}")
async def get_thread(thread_id: str) -> dict[str, Any]:
    if not _brain:
        raise HTTPException(503, "brain not initialized")
    state = _brain.get_state(thread_id)
    return state.model_dump()


@app.post("/threads/{thread_id}/cancel")
async def cancel_thread(thread_id: str) -> dict[str, Any]:
    if not _brain:
        raise HTTPException(503, "brain not initialized")
    ok = _brain.cancel(thread_id)
    return {"thread_id": thread_id, "cancelled": ok}


# ─── AG-UI 协议端点 (核心) ─────────────────────────────────────────────
# CopilotKit React 用 @urql/core 发 GraphQL mutation, 期待 GraphQL JSON 响应
# 不是 SSE 事件流! 响应里 messages 数组, 每个 message 是 TextMessageOutput 类型
#
# 协议 schema (前端发的):
#   mutation generateCopilotResponse($data: GenerateCopilotResponseInput!) {
#     generateCopilotResponse(data: $data) {
#       threadId runId extensions { openaiAssistantAPI { runId threadId } }
#       messages @stream {
#         __typename
#         ... on TextMessageOutput { content @stream role parentMessageId }
#         ... on ActionExecutionMessageOutput { name arguments @stream parentMessageId }
#         ... on ResultMessageOutput { result actionExecutionId actionName }
#       }
#     }
#   }
#
# 我们走方案 1: 不实现真 GraphQL @stream, 用一次性 JSON 响应, messages 数组装全部
# 老板能立即聊天 (UI 会显示 "Loading..." 直到响应完, 然后渲染), 流式后续加

@app.post("/api/agent")
async def agui_endpoint(request: Request) -> JSONResponse:
    """AG-UI 端点 (GraphQL 兼容, 老板 2026-06-15 拍板重写).

    路由:
      - generateCopilotResponse (mutation) → 跑 brain, 累积 events 成 messages 数组
      - availableAgents (query) → 返回 agent 列表 (stub 1 个 default)
      - loadAgentState (query) → 返回空 thread state
      - 其它 op → 返回空 data
    """
    if not _brain:
        raise HTTPException(503, "brain not initialized")

    # 鉴权 (B 阶段默认关, 阶段 6 强开)
    if _config and _config.require_auth:
        token = request.headers.get("authorization", "").replace("Bearer ", "")
        if not _config.auth_token or token != _config.auth_token:
            raise HTTPException(401, "invalid or missing auth token")

    try:
        body = await request.json()
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"invalid JSON: {e}")

    operation_name = body.get("operationName", "") or ""
    # ⚠️ 调试: 老板 2026-06-15 反馈 chat 静默, 看空 op 是啥
    if not operation_name:
        logger.warning(f"[agui] 空 operationName! body keys={list(body.keys())}, query head={(body.get('query','') or '')[:120]}")
    logger.info(f"[agui] op={operation_name}")

    # ─── 路由: GraphQL Introspection (urql 客户端启动时探测 schema) ─────
    # 老板 2026-06-15 反馈 chat 静默, 根因: urql 发的 introspection 查询
    # 被我返回 {"data": {"": null}} 整坏, 导致 urql schema 探测失败,
    # 后续 generateCopilotResponse 也没法正常工作
    # 修: 返回标准 GraphQL introspection schema, 让 urql 满意
    query_str = (body.get("query") or "").strip()
    if "__schema" in query_str and not operation_name:
        logger.info("[agui] 返回 GraphQL introspection schema")
        return JSONResponse(
            content={"data": {"__schema": _INTROSPECTION_SCHEMA}},
            headers={"X-CopilotKit-Runtime-Version": "1.0.0-dasheng"},
        )

    # ─── 路由: availableAgents (query) ─────────────────────────────
    if operation_name == "availableAgents":
        return JSONResponse(
            content={"data": {"availableAgents": {
                "agents": [
                    {"id": "default", "name": "Dasheng Default Agent", "description": "总入口 agent (deerflow 驱动 · 底层 LLM = hermes-agent)"},
                ],
            }}},
            headers={"X-CopilotKit-Runtime-Version": "1.0.0-dasheng"},
        )

    # ─── 路由: loadAgentState (query) ─────────────────────────────
    if operation_name == "loadAgentState":
        data = body.get("variables", {}).get("data", {}) or {}
        thread_id = data.get("threadId") or f"t_{uuid.uuid4().hex[:8]}"
        return JSONResponse(
            content={"data": {"loadAgentState": {
                "threadId": thread_id,
                "threadExists": False,
                "state": "{}",
                "messages": "[]",
            }}},
            headers={"X-CopilotKit-Runtime-Version": "1.0.0-dasheng"},
        )

    # ─── 路由: generateCopilotResponse (mutation) ──────────────────
    if operation_name in ("generateCopilotResponse", ""):
        # 老板 2026-06-15 反馈: 前端用 GraphQL 包装, messages 在 variables.data.messages
        # 但也支持直接 JSON 形态 (调试用)
        if "variables" in body:
            req = body.get("variables", {}).get("data", {}) or {}
        else:
            req = body
        thread_id = req.get("threadId") or f"t_{uuid.uuid4().hex[:8]}"
        run_id = req.get("runId") or f"r_{uuid.uuid4().hex[:8]}"
        agent_id = req.get("agentId") or "default"
        raw_messages = req.get("messages", [])
        messages = _convert_agui_messages(raw_messages)

        logger.info(
            f"[generateCopilotResponse] thread={thread_id} run={run_id} agent={agent_id} "
            f"messages={len(messages)} last_role={messages[-1].role if messages else 'NONE'}"
        )

        out_messages, error_msg = await _run_brain_and_collect(
            messages=messages, thread_id=thread_id, run_id=run_id, agent_id=agent_id,
        )

        # ⚠️ 2026-06-15 关键: 没有 text 也要返回空 messages 数组 (前端不会崩)
        #    这样用户能看到 "我: 你好" 但 "AI: (没东西)" — 跟"对话"失败明显区分
        if not out_messages and not error_msg:
            out_messages = [{
                "__typename": "TextMessageOutput",
                "id": f"msg_empty_{uuid.uuid4().hex[:8]}",
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "status": {"__typename": "SuccessMessageStatus", "code": "success"},
                "content": ["(无响应)"],
                "role": "assistant",
                "parentMessageId": messages[-1].id if messages and messages[-1].role == MessageRole.USER else None,
            }]

        response_payload: dict[str, Any] = {
            "data": {
                "generateCopilotResponse": {
                    "threadId": thread_id,
                    "runId": run_id,
                    "extensions": {"openaiAssistantAPI": {"runId": run_id, "threadId": thread_id}},
                    "status": {"code": "success" if not error_msg else "failed", **({"reason": error_msg} if error_msg else {})},
                    "messages": out_messages,
                    "metaEvents": [],
                },
            },
        }
        if error_msg:
            # GraphQL 错误也放 errors 数组 (urql 会看到)
            response_payload["errors"] = [{"message": error_msg, "extensions": {"code": "RUNTIME_ERROR"}}]

        return JSONResponse(
            content=response_payload,
            headers={"X-CopilotKit-Runtime-Version": "1.0.0-dasheng"},
        )

    # ─── 未知 op → 返回空 data, 不崩 ─────────────────────────────
    logger.warning(f"[agui] 未知 operation: {operation_name!r}, 返回空")
    return JSONResponse(
        content={"data": {operation_name or "unknown": None}},
        headers={"X-CopilotKit-Runtime-Version": "1.0.0-dasheng"},
    )


# ─── 辅助: GraphQL 响应构建 ────────────────────────────────────────────

async def _run_brain_and_collect(
    messages: list[Message],
    thread_id: str,
    run_id: str,
    agent_id: str,
) -> tuple[list[dict[str, Any]], str | None]:
    """
    跑 brain 流, 累积所有 TEXT_DELTA 成 1 个 TextMessageOutput, 工具调用累积成 ActionExecutionMessageOutput.
    返回 (messages_list, error_msg)
    """
    text_chunks: list[str] = []
    tool_calls: dict[str, dict[str, Any]] = {}  # tool_call_id -> {name, args, result}
    error_msg: str | None = None
    message_id = f"msg_{uuid.uuid4().hex[:12]}"
    parent_msg_id = messages[-1].id if messages and messages[-1].role == MessageRole.USER else None

    try:
        async for event in _brain.stream(
            messages=messages,
            tools=None,
            thread_id=thread_id,
            agent_id=agent_id,
        ):
            if event.type == AgentEventType.TEXT_DELTA and event.delta:
                text_chunks.append(event.delta)
            elif event.type == AgentEventType.TOOL_CALL_START and event.tool_call_id:
                tool_calls[event.tool_call_id] = {
                    "name": event.tool_name or "unknown",
                    "args_parts": [],
                    "result": None,
                }
            elif event.type == AgentEventType.TOOL_CALL_ARGS and event.tool_call_id in tool_calls:
                if isinstance(event.args, dict):
                    tool_calls[event.tool_call_id]["args_parts"].append(json.dumps(event.args, ensure_ascii=False))
            elif event.type == AgentEventType.TOOL_CALL_RESULT and event.tool_call_id in tool_calls:
                tool_calls[event.tool_call_id]["result"] = event.result
            elif event.type == AgentEventType.RUN_ERROR:
                error_msg = event.error or "unknown error"
    except Exception as e:
        logger.exception(f"[agui] brain stream error: {e}")
        error_msg = str(e)

    now_iso = datetime.now(timezone.utc).isoformat()
    out: list[dict[str, Any]] = []

    # 1) TextMessageOutput (如果有任何文本)
    if text_chunks:
        out.append({
            "__typename": "TextMessageOutput",
            "id": message_id,
            "createdAt": now_iso,
            "status": {"__typename": "SuccessMessageStatus", "code": "success"} if not error_msg else {"__typename": "FailedMessageStatus", "code": "failed", "reason": error_msg},
            "content": text_chunks,  # 数组, urql 会 join
            "role": "assistant",
            "parentMessageId": parent_msg_id,
        })

    # 2) ActionExecutionMessageOutput (每个工具调用一条)
    for tc_id, tc in tool_calls.items():
        args_str = "".join(tc["args_parts"]) if tc["args_parts"] else "{}"
        out.append({
            "__typename": "ActionExecutionMessageOutput",
            "id": f"action_{tc_id}",
            "createdAt": now_iso,
            "status": {"__typename": "SuccessMessageStatus", "code": "success"} if tc["result"] is not None else {"__typename": "PendingMessageStatus", "code": "pending"},
            "name": tc["name"],
            "arguments": [args_str],
            "parentMessageId": parent_msg_id,
        })
        # 工具完成后跟一条 ResultMessageOutput
        if tc["result"] is not None:
            out.append({
                "__typename": "ResultMessageOutput",
                "id": f"result_{tc_id}",
                "createdAt": now_iso,
                "status": {"__typename": "SuccessMessageStatus", "code": "success"},
                "result": tc["result"] if isinstance(tc["result"], str) else json.dumps(tc["result"], ensure_ascii=False),
                "actionExecutionId": f"action_{tc_id}",
                "actionName": tc["name"],
            })

    return out, error_msg


# ─── 辅助: CopilotKit 消息转换 ─────────────────────────────────────────

def _convert_agui_messages(raw: list[dict[str, Any]]) -> list[Message]:
    """CopilotKit GraphQL 消息格式 (textMessage / actionExecutionMessage / resultMessage / imageMessage 子对象)
    或简单 {id, role, content} 格式 -> 我们的 Message 列表"""
    out = []
    for m in raw:
        role_str = (m.get("role") or "user").lower()
        try:
            role = MessageRole(role_str)
        except ValueError:
            role = MessageRole.USER
        # CopilotKit GraphQL 形态: { id, textMessage: { content, role, parentMessageId } }
        # 或简单形态: { id, role, content }
        content = m.get("content", "")
        if not content and m.get("textMessage"):
            tm = m["textMessage"]
            content = tm.get("content", "")
            if tm.get("role"):
                role_str = tm["role"].lower()
                try:
                    role = MessageRole(role_str)
                except ValueError:
                    pass
        out.append(Message(
            id=m.get("id", str(uuid.uuid4())),
            role=role,
            content=content if isinstance(content, str) else str(content),
            tool_call_id=m.get("toolCallId"),
            tool_calls=m.get("toolCalls"),
            name=m.get("name"),
        ))
    return out


# ─── GraphQL Introspection Schema (供 urql 启动探测) ────────────────────
# 老板 2026-06-15 反馈: 不返回这个 urql schema 探测失败, 后续 chat 也坏
# 极简版, 只声明前端实际查的字段, 够用即可
_INTROSPECTION_SCHEMA: dict[str, Any] = {
    "__typename": "__Schema",
    "queryType": {"name": "Query"},
    "mutationType": {"name": "Mutation"},
    "subscriptionType": None,
    "types": [
        {"__typename": "__Type", "kind": "OBJECT", "name": "Query", "fields": [
            {"__typename": "__Field", "name": "availableAgents", "args": [], "type": {"__typename": "__Type", "kind": "OBJECT", "name": "AvailableAgentsResult"}},
        ]},
        {"__typename": "__Type", "kind": "OBJECT", "name": "AvailableAgentsResult", "fields": [
            {"__typename": "__Field", "name": "agents", "args": [], "type": {"__typename": "__Type", "kind": "LIST", "ofType": {"__typename": "__Type", "kind": "OBJECT", "name": "AgentInfo"}}},
        ]},
        {"__typename": "__Type", "kind": "OBJECT", "name": "AgentInfo", "fields": [
            {"__typename": "__Field", "name": "id", "args": [], "type": {"__typename": "__Type", "kind": "NON_NULL", "ofType": {"__typename": "__Type", "kind": "SCALAR", "name": "String"}}},
            {"__typename": "__Field", "name": "name", "args": [], "type": {"__typename": "__Type", "kind": "NON_NULL", "ofType": {"__typename": "__Type", "kind": "SCALAR", "name": "String"}}},
            {"__typename": "__Field", "name": "description", "args": [], "type": {"__typename": "__Type", "kind": "SCALAR", "name": "String"}},
        ]},
    ],
}


# ─── 入口 ──────────────────────────────────────────────────────────────
def main() -> None:
    import uvicorn
    # ⚠️ CORS 已在 module load 时注册 (见 app.add_middleware 上方注释)
    # 这里不再调 _setup_cors() (那是旧代码, 留兼容 stub)
    global _config
    _config = AgentConfig.from_env()
    uvicorn.run(
        "agent.main:app",
        host=_config.host,
        port=_config.port,
        log_level="debug" if _config.debug else "info",
        reload=False,
    )


if __name__ == "__main__":
    main()
