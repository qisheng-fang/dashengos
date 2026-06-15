"""
配置加载 — 环境变量优先, 其次 ~/.dasheng/config.toml, 最后默认值
================================================================

老板 2026-06-15 原则 #5: 密钥不进代码, 跑前从 env 读

不强制 config.toml 存在, 没有就走 env + defaults, 这样 docker 化时只配 env 就够
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DASHENG_HOME = Path(os.environ.get("DASHENG_HOME", Path.home() / ".dasheng"))


@dataclass
class AgentConfig:
    """Agent Bridge 整体配置。"""
    # 服务端口
    port: int = 8001
    health_port: int = 8003
    host: str = "0.0.0.0"

    # Brain backend 选择 (deerflow / hermes)
    # 6/15 老板拍板: DeerFlow 2.0 是 v0.3 核心驱动, 默认 deerflow
    # 切回 hermes: DASHENG_BRAIN_BACKEND=hermes
    brain_backend: str = "deerflow"

    # LLM 配置 (传给 backend) — None = 用 hermes 自己 ~/.hermes/.env 的默认
    # ⚠️ 关键: 默认值不能写死, 不然会覆盖 hermes 的真实配置 (HERMES_MODEL / OPENAI_BASE_URL 等)
    model: str | None = None
    api_key: str = ""
    base_url: str | None = None
    provider: str | None = None

    # 跨域 (开发期宽松, 上线收紧)
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:3000"])

    # 鉴权 (B 阶段默认关, 阶段 6 强开)
    require_auth: bool = False
    auth_token: str = ""  # 简单 token, A 阶段换 JWT

    # 限流 (B 阶段默认关)
    rate_limit_per_minute: int = 0  # 0 = 不限

    # 调试
    debug: bool = False

    @classmethod
    def from_env(cls) -> "AgentConfig":
        """从环境变量读, 不读 config.toml (简化)"""
        api_key = (
            os.environ.get("DASHENG_LLM_API_KEY")
            or os.environ.get("OPENROUTER_API_KEY")
            or os.environ.get("DEEPSEEK_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
            or ""
        )
        return cls(
            port=int(os.environ.get("DASHENG_AGENT_PORT", "8001")),
            health_port=int(os.environ.get("DASHENG_HEALTH_PORT", "8003")),
            host=os.environ.get("DASHENG_AGENT_HOST", "0.0.0.0"),
            brain_backend=os.environ.get("DASHENG_BRAIN_BACKEND", "deerflow"),
            model=os.environ.get("DASHENG_LLM_MODEL") or None,  # 默认 None → hermes 用自己的
            api_key=api_key,
            base_url=os.environ.get("DASHENG_LLM_BASE_URL") or None,  # 默认 None → hermes 用自己的
            provider=os.environ.get("DASHENG_LLM_PROVIDER") or None,
            cors_origins=[o.strip() for o in os.environ.get("DASHENG_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
            require_auth=os.environ.get("DASHENG_REQUIRE_AUTH", "false").lower() == "true",
            auth_token=os.environ.get("DASHENG_AUTH_TOKEN", ""),
            rate_limit_per_minute=int(os.environ.get("DASHENG_RATE_LIMIT", "0")),
            debug=os.environ.get("DASHENG_DEBUG", "false").lower() == "true",
        )

    def to_brain_config(self) -> dict[str, Any]:
        """提取给 brain 的配置 (hermes / dasheng 共用形状)"""
        return {
            "model": self.model,
            "api_key": self.api_key,
            "base_url": self.base_url,
            "provider": self.provider,
        }
