"""
AgentBrain ABC + 公共类型定义
============================

老板 2026-06-15 拍板的 Adapter Boundary 模式 (六边形架构):
  Frontend (CopilotKit AG-UI) → AgentBrain ABC → {HermesBrain, DashengBrain}

这一层是隔离的关键 — UI 只跟 ABC 说话, 不知道后面是 hermes 还是自己写的 agent。
未来 A 阶段 (dasheng_brain.py) 写完, 换 import 就行, UI 零改动。

⚠️ 关键约束 (B 阶段军规):
  - 本文件禁止 import 任何 hermes_agent.* / langchain.* / 具体 LLM 库
  - 只用 Python 标准库 + Pydantic + typing
  - 任何具体实现 (hermes, dasheng) 都必须满足这个 ABC
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, AsyncIterator, Literal

from pydantic import BaseModel, Field


# ─── 工具命名 (我们的 enum, 不直接用 hermes 的名字) ──────────────────────

class ToolName(str, Enum):
    """我们对外暴露的工具名。hermes_brain.py 里映射到 hermes 内部名字。"""
    BROWSER = "browser"
    FILE = "file"
    VISION = "vision"
    CRON = "cron"
    FEISHU = "feishu"
    WEB = "web"
    CODE_EXECUTION = "code_execution"
    DELEGATE = "delegate"
    TTS = "tts"
    TERMINAL = "terminal"
    MEMORY = "memory"
    SKILLS = "skills"
    TODO = "todo"
    SESSION_SEARCH = "session_search"
    CLARIFY = "clarify"


# ─── 消息 / 内容 ────────────────────────────────────────────────────────

class MessageRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class Message(BaseModel):
    """统一的消息格式 (跟 hermes 的 message 形状兼容, 但 schema 我们定)"""
    id: str
    role: MessageRole
    content: str
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None  # OpenAI-style tool calls
    name: str | None = None  # for tool role
    created_at: str | None = None


# ─── 工具定义 ──────────────────────────────────────────────────────────

class ToolParameter(BaseModel):
    name: str
    type: Literal["string", "number", "boolean", "object", "array"]
    description: str = ""
    required: bool = False
    enum: list[str] | None = None


class ToolDef(BaseModel):
    """对外暴露的工具元数据 (AG-UI 协议要这个)"""
    name: ToolName
    description: str
    parameters: list[ToolParameter] = Field(default_factory=list)


# ─── Agent 事件 (流式) ─────────────────────────────────────────────────

class AgentEventType(str, Enum):
    TEXT_DELTA = "TEXT_MESSAGE_CONTENT"      # 增量文本
    TEXT_START = "TEXT_MESSAGE_START"
    TEXT_END = "TEXT_MESSAGE_END"
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"
    RUN_STARTED = "RUN_STARTED"
    RUN_FINISHED = "RUN_FINISHED"
    RUN_ERROR = "RUN_ERROR"
    STATE_SNAPSHOT = "STATE_SNAPSHOT"
    CUSTOM = "CUSTOM"


class AgentEvent(BaseModel):
    """流式事件, 跟 AG-UI protocol 事件形状对齐"""
    type: AgentEventType
    # 通用字段
    message_id: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    delta: str | None = None  # for TEXT_MESSAGE_CONTENT
    args: dict[str, Any] | None = None  # for TOOL_CALL_ARGS
    result: Any | None = None  # for TOOL_CALL_RESULT
    error: str | None = None
    # 元数据
    timestamp: float = 0.0
    raw: dict[str, Any] | None = None  # 原始事件 (debug 用)


# ─── 线程状态 ─────────────────────────────────────────────────────────

class ThreadState(BaseModel):
    thread_id: str
    agent_id: str = "default"
    messages: list[Message] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ─── ABC ───────────────────────────────────────────────────────────────

class AgentBrain(ABC):
    """所有 agent 实现的抽象基类。

    设计原则:
      - 异步流式 (async generator) 符合 AG-UI 协议
      - 状态持久化由实现自己处理, 抽象层不假设存储后端
      - 工具注册表跟具体实现解耦
    """

    @abstractmethod
    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDef] | None,
        thread_id: str,
        agent_id: str = "default",
        config: dict[str, Any] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """流式产生 agent 事件, 直到 RUN_FINISHED 或 RUN_ERROR。

        入参 messages 不含历史 (历史由实现自己从 thread_id 拉)。
        """
        if False:  # 让 type checker 知道这是 async generator
            yield
        raise NotImplementedError

    @abstractmethod
    def list_tools(self, agent_id: str = "default") -> list[ToolDef]:
        """列出该 agent 可用的工具。"""
        raise NotImplementedError

    @abstractmethod
    def get_state(self, thread_id: str) -> ThreadState:
        """取线程状态 (历史消息 + 元数据)。"""
        raise NotImplementedError

    @abstractmethod
    def cancel(self, thread_id: str) -> bool:
        """取消正在跑的 agent 循环。返回是否成功取消。"""
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict[str, Any]:
        """健康检查, 返回 backend 类型 + 版本 + uptime 等元数据。"""
        raise NotImplementedError
