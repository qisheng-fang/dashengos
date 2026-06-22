"""
HermesBrain — Adapter Boundary 的 hermes 实现
=============================================

⚠️ 老板 2026-06-15 拍板的"留后门"军规 #1:
  本文件是 ai-workbench-v2 项目里**唯一**可以 import hermes_agent.* 的文件
  其他所有文件 (brain.py, main.py, config.py, tools/*) 都禁止 import hermes
  违反这条 = 引入隐性供应链依赖, A 阶段重写时爆炸

封装策略:
  - 把 hermes-agent 的 AIAgent 适配到我们的 AgentBrain ABC
  - 工具名走我们自己的 ToolName enum, 不暴露 hermes 内部名字
  - 数据写到 ~/.dasheng/ (不写到 ~/.hermes/), hermes 内部 session 仅作缓存
  - 锁 hermes-agent 版本 (v0.13.0, commit 1af2e18d4) — 升级需老板批准

未来 A 阶段:
  - 写 dasheng_brain.py 实现同一 ABC
  - 改 brain_factory.py 的 BRAIN_BACKEND 默认值即可, UI 零改动
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

# ⚠️ 唯一允许 import hermes 相关的地方 ↓↓↓↓↓
# ⚠️ 老板 2026-06-15 军规: hermes-agent 用扁平布局, 顶级模块是 run_agent / toolsets / hermes_cli 等
#    (不是 hermes_agent.run_agent). 看 hermes-agent/pyproject.toml [tool.setuptools] py-modules
try:
    from run_agent import AIAgent
    from toolsets import get_all_toolsets, get_toolset_names
    _HERMES_AVAILABLE = True
    _HERMES_IMPORT_ERROR: str | None = None
except ImportError as e:
    _HERMES_AVAILABLE = False
    _HERMES_IMPORT_ERROR = str(e)
    AIAgent = None  # type: ignore
    get_all_toolsets = None  # type: ignore
    get_toolset_names = None  # type: ignore
# ⚠️ 唯一允许 import hermes 相关的地方 ↑↑↑↑↑

from .brain import (
    AgentBrain,
    AgentEvent,
    AgentEventType,
    Message,
    MessageRole,
    ThreadState,
    ToolDef,
    ToolName,
    ToolParameter,
)

logger = logging.getLogger(__name__)

# ─── hermes-agent 版本锁 (老板批准才能改) ──────────────────────────────
HERMES_AGENT_VERSION = "0.13.0"
HERMES_AGENT_COMMIT = "1af2e18d4"

# ─── 工具映射 (我们的 ToolName → hermes 内部 toolset 名字) ─────────────
# hermes 用 toolset 概念, 一个 toolset 含多个 tool
# 我们把 toolset 名映射到我们的 ToolName enum
HERMES_TOOLSET_TO_OUR_TOOL: dict[str, ToolName] = {
    "browser": ToolName.BROWSER,
    "file": ToolName.FILE,
    "vision": ToolName.VISION,
    "cron": ToolName.CRON,
    "feishu_doc": ToolName.FEISHU,  # 含 feishu doc/drive/bot 等
    "web": ToolName.WEB,
    "code_execution": ToolName.CODE_EXECUTION,
    "delegate": ToolName.DELEGATE,
    "tts": ToolName.TTS,
    "terminal": ToolName.TERMINAL,
    "memory": ToolName.MEMORY,
    "skills": ToolName.SKILLS,
    "todo": ToolName.TODO,
    "session_search": ToolName.SESSION_SEARCH,
    "clarify": ToolName.CLARIFY,
}


# ─── 元数据存储位置 (B 阶段数据不写到 ~/.hermes/) ──────────────────────
DASHENG_HOME = Path(os.environ.get("DASHENG_HOME", Path.home() / ".dasheng"))


class HermesBrain(AgentBrain):
    """Hermes-agent 的 AgentBrain 实现。"""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        if not _HERMES_AVAILABLE:
            raise RuntimeError(
                f"hermes_agent import 失败: {_HERMES_IMPORT_ERROR}\n"
                f"请确认已 `uv pip install -e /Users/apple/.hermes/hermes-agent`"
            )
        self.config = config or {}
        self._agents: dict[str, AIAgent] = {}  # agent_id -> AIAgent 实例
        self._active_runs: dict[str, bool] = {}  # thread_id -> is_running
        self._start_time = time.time()
        # 确保 DASHENG_HOME 存在
        DASHENG_HOME.mkdir(parents=True, exist_ok=True)
        (DASHENG_HOME / "sessions").mkdir(exist_ok=True)
        logger.info(
            f"[HermesBrain] init OK · version={HERMES_AGENT_VERSION} · commit={HERMES_AGENT_COMMIT} · home={DASHENG_HOME}"
        )

    # ─── 内部: 获取/创建 AIAgent 实例 (per agent_id 复用) ────────────
    def _get_ai_agent(self, agent_id: str) -> AIAgent:
        if agent_id not in self._agents:
            api_key = (
                self.config.get("api_key")
                or os.environ.get("OPENROUTER_API_KEY")
                or os.environ.get("DEEPSEEK_API_KEY")
                or os.environ.get("OPENAI_API_KEY")
            )
            if not api_key:
                raise RuntimeError(
                    "未配置 LLM API key. 设 OPENROUTER_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY 环境变量"
                )
            # ⚠️ 关键: 只在显式配 model/base_url 时才传给 AIAgent
            #    否则 hermes 会用自己 ~/.hermes/.env 里的默认 (如 HERMES_MODEL=Qwen/Qwen2.5-72B-Instruct)
            #    避免硬编码 default 覆盖 hermes 的真实配置
            ai_kwargs: dict[str, Any] = {
                "quiet_mode": True,
                "save_trajectories": False,
                "stream_delta_callback": None,
                "tool_start_callback": None,
                "tool_complete_callback": None,
            }
            if self.config.get("model"):
                ai_kwargs["model"] = self.config["model"]
            if self.config.get("base_url"):
                ai_kwargs["base_url"] = self.config["base_url"]
            if api_key:
                ai_kwargs["api_key"] = api_key
            self._agents[agent_id] = AIAgent(**ai_kwargs)
        return self._agents[agent_id]

    # ─── AgentBrain.stream ──────────────────────────────────────────
    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDef] | None,
        thread_id: str,
        agent_id: str = "default",
        config: dict[str, Any] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """流式跑 hermes agent, 把 hermes 事件翻译成我们的 AgentEvent。"""
        ai = self._get_ai_agent(agent_id)
        self._active_runs[thread_id] = True
        run_id = str(uuid.uuid4())
        started_at = time.time()

        # 状态收集: hermes 回调里写, 协程从 queue 里读
        event_queue: asyncio.Queue[AgentEvent] = asyncio.Queue()
        loop = asyncio.get_event_loop()

        def _push(event: AgentEvent) -> None:
            """hermes 的 callback 是同步的, 推到 asyncio.Queue"""
            loop.call_soon_threadsafe(event_queue.put_nowait, event)

        # 装上 callbacks (每次 stream 调用临时装, 跑完恢复)
        original_stream_delta = ai.stream_delta_callback
        original_tool_start = ai.tool_start_callback
        original_tool_complete = ai.tool_complete_callback
        # ⚠️ hermes bug: stream_callback 每 token 调 2 次, 前端会显示 "我我赫赫"
        # 在我们这边去重: 跟 last delta 比, 相同就丢
        last_delta: dict[str, str] = {"text": ""}
        try:
            def _on_text_delta(delta: str) -> None:
                if delta == last_delta["text"]:
                    return
                last_delta["text"] = delta
                _push(AgentEvent(
                    type=AgentEventType.TEXT_DELTA,
                    message_id=run_id,
                    delta=delta,
                    timestamp=time.time(),
                ))
            ai.stream_delta_callback = _on_text_delta
            # hermes 回调签名: tool_start(id,name,args) 3参数, tool_complete(id,name,args,result) 4参数
            ai.tool_start_callback = lambda tc_id, tc_name, tc_args: _push(
                AgentEvent(
                    type=AgentEventType.TOOL_CALL_START,
                    tool_name=tc_name,
                    args=tc_args if isinstance(tc_args, dict) else {"raw": str(tc_args)[:500]},
                    tool_call_id=tc_id,
                    timestamp=time.time(),
                )
            )
            ai.tool_complete_callback = lambda tc_id, tc_name, tc_args, tc_result: _push(
                AgentEvent(
                    type=AgentEventType.TOOL_CALL_RESULT,
                    tool_name=tc_name,
                    result=tc_result if isinstance(tc_result, dict) else {"raw": str(tc_result)[:2000]} if tc_result is not None else None,
                    tool_call_id=tc_id,
                    timestamp=time.time(),
                )
            )

            # 推送 RUN_STARTED
            yield AgentEvent(
                type=AgentEventType.RUN_STARTED,
                message_id=run_id,
                timestamp=started_at,
            )

            # 转换 messages -> hermes 期望的格式
            # hermes 的 run_conversation 接受 str 或 list[dict]
            # 我们取最后一条 user 消息当 query, 历史从 thread_id 恢复
            hermes_messages = self._convert_messages(messages)
            query = self._extract_last_user_query(messages)

            # 后台跑 hermes (它是同步的, 放线程池)
            # ⚠️ hermes run_conversation 实际参数是 user_message, 不是 query
            # ⚠️ 不要同时设 ai.stream_delta_callback + 传 stream_callback= , 会双触发 delta
            async def _run_hermes() -> None:
                try:
                    result = await loop.run_in_executor(
                        None,
                        lambda: ai.run_conversation(
                            user_message=query,
                            conversation_history=hermes_messages[:-1] if len(hermes_messages) > 1 else None,
                            # 走 ai.stream_delta_callback (我们已经装上去 + 去重)
                            stream_callback=None,
                        ),
                    )
                    # ⚠️ hermes 失败时可能返回 None, 安全取值
                    if isinstance(result, dict):
                        final = result.get("final_response", "") or ""
                    elif result is None:
                        final = ""
                    else:
                        final = str(result)
                    _push(AgentEvent(
                        type=AgentEventType.RUN_FINISHED,
                        message_id=run_id,
                        timestamp=time.time(),
                        raw={"final_response": final[:200]},
                    ))
                except Exception as e:
                    logger.exception(f"[HermesBrain] run error: {e}")
                    _push(AgentEvent(
                        type=AgentEventType.RUN_ERROR,
                        message_id=run_id,
                        error=str(e),
                        timestamp=time.time(),
                    ))

            runner = asyncio.create_task(_run_hermes())

            # 流式从 queue 里读事件
            # ⚠️ AG-UI 协议要求: 文本流要包成 TEXT_MESSAGE_START → CONTENT × N → END 三件套
            #    CopilotKit React 客户端拿 START 知道从哪开始渲染, 拿 END 知道塞到哪个 messageId 里
            #    没有 START/END → 浏览器静默不显示
            current_text_message_id: str | None = None
            current_tool_call_ids: set[str] = set()

            while True:
                # 检查用户取消
                if not self._active_runs.get(thread_id, False):
                    runner.cancel()
                    yield AgentEvent(
                        type=AgentEventType.RUN_ERROR,
                        message_id=run_id,
                        error="cancelled by user",
                        timestamp=time.time(),
                    )
                    break

                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if runner.done():
                        # runner 完事了, 把剩余事件抽干
                        while not event_queue.empty():
                            ev = event_queue.get_nowait()
                            # 文本流补 START
                            if ev.type == AgentEventType.TEXT_DELTA and current_text_message_id is None:
                                current_text_message_id = ev.message_id or str(uuid.uuid4())
                                yield AgentEvent(
                                    type=AgentEventType.TEXT_START,
                                    message_id=current_text_message_id,
                                    timestamp=ev.timestamp,
                                )
                            yield ev
                        break
                    continue

                # 文本流: 第一个 TEXT_DELTA 之前补 START
                if event.type == AgentEventType.TEXT_DELTA:
                    if current_text_message_id is None:
                        current_text_message_id = event.message_id or str(uuid.uuid4())
                        yield AgentEvent(
                            type=AgentEventType.TEXT_START,
                            message_id=current_text_message_id,
                            timestamp=event.timestamp,
                        )
                    yield event
                elif event.type == AgentEventType.TOOL_CALL_START:
                    if event.tool_call_id:
                        current_tool_call_ids.add(event.tool_call_id)
                    yield event
                elif event.type in (AgentEventType.RUN_FINISHED, AgentEventType.RUN_ERROR):
                    # 补 END (按 AG-UI 协议: 文本流结束时要发 END)
                    if current_text_message_id is not None:
                        yield AgentEvent(
                            type=AgentEventType.TEXT_END,
                            message_id=current_text_message_id,
                            timestamp=time.time(),
                        )
                        current_text_message_id = None
                    # 工具流没显式 END 也补一下
                    for tc_id in list(current_tool_call_ids):
                        yield AgentEvent(
                            type=AgentEventType.TOOL_CALL_END,
                            tool_call_id=tc_id,
                            timestamp=time.time(),
                        )
                    current_tool_call_ids.clear()
                    yield event
                    break
                else:
                    yield event

            await runner

        finally:
            # 恢复 callbacks (避免泄漏到下次调用)
            ai.stream_delta_callback = original_stream_delta
            ai.tool_start_callback = original_tool_start
            ai.tool_complete_callback = original_tool_complete
            self._active_runs.pop(thread_id, None)

    # ─── AgentBrain.list_tools ──────────────────────────────────────
    def list_tools(self, agent_id: str = "default") -> list[ToolDef]:
        """列可用工具。从 hermes 的 toolset 系统映射到我们的 ToolDef。"""
        try:
            if get_all_toolsets is None:
                return self._default_tools()
            hermes_toolsets = list((get_all_toolsets() or {}).keys())
        except Exception as e:
            logger.warning(f"[HermesBrain] get_all_toolsets failed: {e}, 用 default")
            hermes_toolsets = list(HERMES_TOOLSET_TO_OUR_TOOL.keys())

        result: list[ToolDef] = []
        for ts in hermes_toolsets:
            our_tool = HERMES_TOOLSET_TO_OUR_TOOL.get(ts)
            if our_tool is None:
                continue
            result.append(ToolDef(
                name=our_tool,
                description=f"hermes toolset: {ts}",
                parameters=[],
            ))
        if not result:
            return self._default_tools()
        return result

    def _default_tools(self) -> list[ToolDef]:
        """hermes 不可用时的 fallback。"""
        return [
            ToolDef(name=ToolName.WEB, description="网络搜索", parameters=[]),
            ToolDef(name=ToolName.FILE, description="文件读写", parameters=[]),
        ]

    # ─── AgentBrain.get_state ───────────────────────────────────────
    def get_state(self, thread_id: str) -> ThreadState:
        """取线程状态。优先从 ~/.dasheng/sessions/{id}.json 读 (我们的存储),
        读不到就返回空 (新线程)。"""
        session_file = DASHENG_HOME / "sessions" / f"{thread_id}.json"
        if session_file.exists():
            try:
                data = json.loads(session_file.read_text())
                return ThreadState(**data)
            except Exception as e:
                logger.warning(f"[HermesBrain] get_state 读 {session_file} 失败: {e}")
        return ThreadState(thread_id=thread_id, messages=[])

    # ─── AgentBrain.cancel ──────────────────────────────────────────
    def cancel(self, thread_id: str) -> bool:
        was_active = self._active_runs.pop(thread_id, None)
        if was_active is not None:
            logger.info(f"[HermesBrain] cancelled thread {thread_id}")
            return True
        return False

    # ─── AgentBrain.health ──────────────────────────────────────────
    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "backend": "hermes",
            "backend_version": HERMES_AGENT_VERSION,
            "backend_commit": HERMES_AGENT_COMMIT,
            "hermes_available": _HERMES_AVAILABLE,
            "hermes_import_error": _HERMES_IMPORT_ERROR,
            "uptime_seconds": time.time() - self._start_time,
            "active_runs": len(self._active_runs),
            "dasheng_home": str(DASHENG_HOME),
            "agents_loaded": list(self._agents.keys()),
        }

    # ─── 内部 helpers ───────────────────────────────────────────────
    @staticmethod
    def _convert_messages(messages: list[Message]) -> list[dict[str, Any]]:
        """我们的 Message -> hermes 的 conversation_history 格式"""
        out = []
        for m in messages:
            entry: dict[str, Any] = {"role": m.role.value, "content": m.content}
            if m.name:
                entry["name"] = m.name
            if m.tool_call_id:
                entry["tool_call_id"] = m.tool_call_id
            if m.tool_calls:
                entry["tool_calls"] = m.tool_calls
            out.append(entry)
        return out

    @staticmethod
    def _extract_last_user_query(messages: list[Message]) -> str:
        for m in reversed(messages):
            if m.role == MessageRole.USER:
                return m.content
        return ""
