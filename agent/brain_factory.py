"""
BrainFactory — 根据环境变量选 AgentBrain 实现
==============================================

B 阶段: 默认 HermesBrain (hermes-agent 作为大脑)
A 阶段: 默认 DashengBrain (自写 AIAgent, 还在 draft)

切换: 改 DASHENG_BRAIN_BACKEND 环境变量, 或直接调用
      brain_factory.create_brain("dasheng")

不重启服务热切换: 删 self._current, 下次 create_brain 重新实例化
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .brain import AgentBrain

logger = logging.getLogger(__name__)

_BACKEND_REGISTRY: dict[str, type[AgentBrain]] = {}


def _register_backends() -> None:
    """懒注册: import 失败不阻塞, 用到时再报错"""
    if _BACKEND_REGISTRY:
        return
    try:
        from .hermes_brain import HermesBrain
        _BACKEND_REGISTRY["hermes"] = HermesBrain
    except Exception as e:
        logger.warning(f"[brain_factory] HermesBrain 加载失败: {e}")

    # P4.2 新增: deerflow 后端 (走 daemon 路径, v0.3 dev guide §35.6)
    try:
        from .deerflow_brain import DeerFlowBrain
        _BACKEND_REGISTRY["deerflow"] = DeerFlowBrain
    except Exception as e:
        logger.warning(f"[brain_factory] DeerFlowBrain 加载失败: {e}")

    # DashengBrain (A 阶段) 还没写, 占位
    # try:
    #     from .dasheng_brain import DashengBrain
    #     _BACKEND_REGISTRY["dasheng"] = DashengBrain
    # except ImportError:
    #     pass


def create_brain(backend: str | None = None, config: dict[str, Any] | None = None) -> AgentBrain:
    """工厂方法: 选 backend, 实例化 brain。"""
    _register_backends()
    backend = backend or os.environ.get("DASHENG_BRAIN_BACKEND", "hermes")
    if backend not in _BACKEND_REGISTRY:
        available = ", ".join(_BACKEND_REGISTRY.keys()) or "(无)"
        raise RuntimeError(
            f"未知 backend: {backend!r}. 可用: {available}. "
            f"检查依赖是否装好 (hermes: uv pip install -e /Users/apple/.hermes/hermes-agent)"
        )
    cls = _BACKEND_REGISTRY[backend]
    logger.info(f"[brain_factory] 创建 brain: backend={backend}, class={cls.__name__}")
    return cls(config=config)


def list_backends() -> list[str]:
    """列出所有可用的 backend (供 /health 和 CLI 用)"""
    _register_backends()
    return list(_BACKEND_REGISTRY.keys())
