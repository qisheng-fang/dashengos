#!/usr/bin/env python3
# deerflow/agents/__init__.py · v0.3 spec §36
#
# Sub-agents registry: 1 lead (orchestrator) + 5 sub-agents (researcher/analyst/writer/security/quality)
# 老板原则 #2: 0 行业务逻辑,薄薄一层
#
# 注册表 from deerflow.yaml · 实际 LLM 调用 via 直连 SiliconFlow (OpenAI 兼容协议)
# 这里只做 sub-agent 选择 + 派发 + 状态轮转
# (P4.1 修复: 删 broken /api/v1/agent/run 路径, spec §35.2 明确 Python daemon 不调 Fastify REST)

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("deerflow.agents")

# openai 包检测 (按 hermes-adapter.py:25-29 模式, 避免 HAS_OPENAI global 陷阱)
try:
    from openai import AsyncOpenAI  # noqa: F401
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

# 1 lead + 5 sub-agents (spec §36.1)
AGENTS_REGISTRY: dict[str, dict] = {}


def load_yaml() -> dict:
    """从 apps/backend/configs/deerflow.yaml 读 (spec §36.1)"""
    # 简化: Phase 3 直接从 yaml parse (避免 import 第三方 lib)
    yaml_path = Path(os.environ.get(
        "DEERFLOW_YAML",
        Path(__file__).parent.parent.parent / "apps/backend/configs/deerflow.yaml",
    ))
    if not yaml_path.exists():
        # 没 yaml 时用 defaults
        return {}
    try:
        import yaml
        with open(yaml_path) as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        # 简版 yaml 解析 (只支持顶级 key-value, 嵌套用缩进)
        return _simple_yaml(yaml_path)


def _simple_yaml(path: Path) -> dict:
    """最简 yaml 解析 (避免 PyYAML 依赖)"""
    out: dict = {}
    cur_path = [out]
    cur_indent = -1
    for line in path.read_text().splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        content = line.lstrip().rstrip()
        # 简单判断: key: value
        if ":" in content and not content.strip().startswith("-"):
            key, _, val = content.partition(":")
            val = val.strip().strip('"').strip("'")
            while len(cur_path) > 1 and indent <= cur_indent:
                cur_path.pop()
                cur_indent = cur_indent
            cur_path[-1][key.strip()] = val if val else {}
            if not val:
                cur_path.append(cur_path[-1][key.strip()])
                cur_indent = indent
    return out


def list_agents() -> list[dict]:
    """列所有 agents (spec §35.4 agent.list)"""
    if not AGENTS_REGISTRY:
        _init_agents_from_yaml()
    return list(AGENTS_REGISTRY.values())


def get_agent(agent_id: str) -> dict | None:
    if not AGENTS_REGISTRY:
        _init_agents_from_yaml()
    return AGENTS_REGISTRY.get(agent_id)


def _init_agents_from_yaml() -> None:
    """从 yaml 读 lead_agent + sub_agents 定义,register 到 AGENTS_REGISTRY"""
    cfg = load_yaml()
    if not cfg:
        _default_agents()
        return

    # Lead agent
    lead = cfg.get("lead_agent", {})
    if lead:
        AGENTS_REGISTRY["orchestrator"] = {
            "name": lead.get("name", "orchestrator"),
            "role": "lead",
            "description": lead.get("description", ""),
            "system_prompt": lead.get("system_prompt", ""),
            "tools": lead.get("tools", []),
            "max_steps": lead.get("max_steps", 30),
            "temperature": lead.get("temperature", 0.3),
            "model": lead.get("model") or os.environ.get("DEERFLOW_LLM_MODEL", "Qwen/Qwen2.5-72B-Instruct"),
        }

    # Sub-agents
    for sa in cfg.get("sub_agents", []):
        name = sa.get("name")
        if not name:
            continue
        AGENTS_REGISTRY[name] = {
            "name": name,
            "role": "sub",
            "description": sa.get("description", ""),
            "system_prompt": sa.get("system_prompt", ""),
            "tools": sa.get("tools", []),
            "max_steps": sa.get("max_steps", 15),
            "temperature": sa.get("temperature", 0.2),
            "model": sa.get("model") or os.environ.get("DEERFLOW_LLM_MODEL", "Qwen/Qwen2.5-72B-Instruct"),
        }


def _default_agents() -> None:
    """yaml 缺时用 hardcoded defaults (Phase 3 简化)"""
    AGENTS_REGISTRY.update({
        "orchestrator": {
            "name": "orchestrator", "role": "lead",
            "description": "Lead agent · 任务拆解+派发+汇总",
            "tools": ["delegate_to_researcher", "delegate_to_analyst", "delegate_to_writer", "delegate_to_security_reviewer", "delegate_to_quality_reviewer"],
            "max_steps": 30, "temperature": 0.3,
        },
        "researcher": {
            "name": "researcher", "role": "sub",
            "description": "行业调研 / 信息搜集 / 多源验证",
            "tools": ["web_search", "browser_navigate", "browser_extract", "file_read"],
            "max_steps": 15, "temperature": 0.2,
        },
        "analyst": {
            "name": "analyst", "role": "sub",
            "description": "数据分析 / 模式识别 / 统计推断",
            "tools": ["sandbox_exec_python", "file_read", "file_write"],
            "max_steps": 20, "temperature": 0.1,
        },
        "writer": {
            "name": "writer", "role": "sub",
            "description": "长文 / 报告 / 文案 / 翻译",
            "tools": ["file_read", "file_write"],
            "max_steps": 10, "temperature": 0.7,
        },
        "security_reviewer": {
            "name": "security_reviewer", "role": "sub",
            "description": "代码审计 / 漏洞扫描 / 合规检查",
            "tools": ["file_read", "sandbox_exec_shell", "web_search"],
            "max_steps": 15, "temperature": 0.1,
        },
        "quality_reviewer": {
            "name": "quality_reviewer", "role": "sub",
            "description": "质量审查 / 逻辑校验 / 错误发现",
            "tools": ["file_read", "web_search"],
            "max_steps": 10, "temperature": 0.2,
        },
    })


async def run_sub_agent(agent_id: str, inp: str, ctx: dict) -> dict:
    """单 sub-agent 调用 (spec §35.4 agent.run)
    P4.1 真接 LLM (SiliconFlow Qwen2.5-72B) + agent 自带 system_prompt
    老板原则 #2: 0 行业务逻辑,薄薄一层
    修复 3 bug:
      - 删 /api/v1/agent/run 路径 (spec §35.2 明确 daemon 不调 Fastify REST)
      - 删 global HAS_OPENAI (从未定义, 改用 module-level import 检测)
      - Key 缺时返清晰错误 (不再 silent stub)
    """
    agent = get_agent(agent_id)
    if not agent:
        raise ValueError(f"agent not found: {agent_id} (available: {list(AGENTS_REGISTRY.keys())})")

    # 1) Opt-in: 走 backend gateway (默认 off, 后端端点尚未实现; 真做统一审计/限流时再开)
    if os.environ.get("DEERFLOW_USE_BACKEND_AGENT", "false").lower() == "true":
        backend_url = os.environ.get("DASHENG_BACKEND_URL", "http://127.0.0.1:8000")
        try:
            import urllib.request, json as _json
            req = urllib.request.Request(
                f"{backend_url}/api/v1/agent/run",
                data=_json.dumps({"agentId": agent_id, "input": inp, "context": ctx}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = _json.loads(resp.read().decode())
                return {"output": data.get("output", ""), "agent": agent_id, "model": data.get("model")}
        except Exception as e:
            logger.warning("backend agent.run failed (%s), falling back to direct LLM", e)

    # 2) 主路径: 直调 LLM (按 spec §35.2 架构, daemon 内部 LLM 能力)
    if not HAS_OPENAI:
        return {
            "output": f"[{agent_id} stub] {inp[:200]}",
            "agent": agent_id,
            "tools": agent.get("tools", []),
            "error": "openai package not installed · cd deerflow && uv add 'openai>=1.0,<2.0'",
        }

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "output": f"[{agent_id} stub] {inp[:200]}",
            "agent": agent_id,
            "tools": agent.get("tools", []),
            "error": "OPENAI_API_KEY not set · export OPENAI_API_KEY=... 或放 ~/.workbuddy/credentials/OPENAI_API_KEY.env (daemon 启动时会自动 inject)",
        }

    client = AsyncOpenAI(
        base_url=os.environ.get("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1"),
        api_key=api_key,
    )
    sys_prompt = agent.get("system_prompt") or f"你是 {agent['name']} agent. 任务: {agent.get('description', '')}"
    model = agent.get("model", "Qwen/Qwen2.5-72B-Instruct")
    messages = [{"role": "system", "content": sys_prompt}]
    # 上下文
    if ctx.get("history") and isinstance(ctx["history"], list):
        messages.extend(ctx["history"])
    if ctx.get("taskId"):
        messages.append({"role": "system", "content": f"任务ID: {ctx['taskId']}"})
    messages.append({"role": "user", "content": inp})

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=agent.get("temperature", 0.3),
        )
        output = resp.choices[0].message.content or ""
        return {
            "output": output,
            "agent": agent_id,
            "model": model,
            "tools": agent.get("tools", []),
            "tokens": {
                "prompt": resp.usage.prompt_tokens if resp.usage else 0,
                "completion": resp.usage.completion_tokens if resp.usage else 0,
            } if resp.usage else None,
        }
    except Exception as e:
        return {
            "output": f"[{agent_id} LLM error] {inp[:100]}",
            "agent": agent_id,
            "tools": agent.get("tools", []),
            "error": f"{type(e).__name__}: {e!s}"[:200],
        }


# ---------- skill registry (spec §35.4 skill.list/load) ---------

SKILLS_BUILTIN = [
    {"id": "web-search", "name": "Web Search", "category": "research", "source": "builtin"},
    {"id": "code-exec-python", "name": "Python Code Exec", "category": "tools", "source": "builtin"},
    {"id": "tavily", "name": "Tavily Search", "category": "research", "source": "marketplace"},
]


def list_skills(category: str | None = None) -> list[dict]:
    if category:
        return [s for s in SKILLS_BUILTIN if s["category"] == category]
    return SKILLS_BUILTIN


def load_skill(skill_id: str) -> dict:
    for s in SKILLS_BUILTIN:
        if s["id"] == skill_id:
            return {
                "manifest": s,
                "content": f"# {s['name']}\n\nSkill content for {skill_id} (Phase 3 stub)",
            }
    raise FileNotFoundError(f"skill not found: {skill_id}")
