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
    """Real agent loop with tool use — Phase 4 (2026-06-17)

    不再是单次 LLM 调用，而是真正的 multi-step agent loop：
      1. 发 user input + system prompt → LLM
      2. LLM 返回 tool_calls → 执行工具 → 结果喂回 LLM
      3. 重复直到 LLM 不再要求 tool_calls 或 达到 max_steps

    支持的工具:
      - web_search(query) — DuckDuckGo HTML 搜索
      - file_read(path) — 读本地文件
      - file_write(path, content) — 写本地文件
      - sandbox_exec_python(code) — subprocess 跑 Python 代码
    """
    import asyncio
    import json as _json
    import subprocess
    import tempfile
    import urllib.request
    import urllib.parse

    agent = get_agent(agent_id)
    if not agent:
        raise ValueError(f"agent not found: {agent_id} (available: {list(AGENTS_REGISTRY.keys())})")

    if not HAS_OPENAI:
        return {"output": f"[{agent_id} stub] {inp[:200]}", "agent": agent_id,
                "error": "openai package not installed"}

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"output": f"[{agent_id} stub] {inp[:200]}", "agent": agent_id,
                "error": "OPENAI_API_KEY not set"}

    client = AsyncOpenAI(
        base_url=os.environ.get("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1"),
        api_key=api_key,
    )
    model = agent.get("model") or os.environ.get("DEERFLOW_LLM_MODEL", "Qwen/Qwen2.5-72B-Instruct")
    max_steps = min(agent.get("max_steps", 10), 20)  # 硬上限 20 步

    # ---- 工具实现（异步） ----

    async def _web_search(query: str) -> str:
        """DuckDuckGo HTML 搜索，返回摘要文本"""
        try:
            encoded = urllib.parse.quote(query)
            url = f"https://html.duckduckgo.com/html/?q={encoded}"
            req = urllib.request.Request(url, headers={"User-Agent": "DaShengOS/0.3"})
            loop = asyncio.get_running_loop()
            resp = await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=15))
            html = resp.read().decode("utf-8", errors="replace")
            # 简单提取文本内容
            import re
            snippets = re.findall(r'class="result__snippet">(.*?)</a>', html, re.DOTALL)
            if snippets:
                results = [re.sub(r'<[^>]+>', '', s).strip()[:300] for s in snippets[:5]]
                return "\n\n".join(f"[{i+1}] {r}" for i, r in enumerate(results))
            return "无搜索结果"
        except Exception as e:
            return f"搜索失败: {e}"

    async def _file_read(path: str) -> str:
        try:
            p = Path(path).expanduser().resolve()
            loop = asyncio.get_running_loop()
            content = await loop.run_in_executor(None, lambda: p.read_text(encoding="utf-8"))
            max_len = 8000
            return content[:max_len] + ("...(截断)" if len(content) > max_len else "")
        except Exception as e:
            return f"读文件失败: {e}"

    async def _file_write(path: str, content: str) -> str:
        try:
            p = Path(path).expanduser().resolve()
            p.parent.mkdir(parents=True, exist_ok=True)
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: p.write_text(content, encoding="utf-8"))
            return f"写入成功: {p} ({len(content)} 字符)"
        except Exception as e:
            return f"写文件失败: {e}"

    async def _sandbox_exec_python(code: str) -> str:
        try:
            loop = asyncio.get_running_loop()
            proc = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    ["python3", "-c", code],
                    capture_output=True, text=True, timeout=30,
                    cwd=tempfile.gettempdir(),
                ),
            )
            output = ""
            if proc.stdout:
                output += proc.stdout
            if proc.stderr:
                output += f"\n[stderr]\n{proc.stderr}"
            return output.strip() or "(无输出)"
        except subprocess.TimeoutExpired:
            return "执行超时 (30s)"
        except Exception as e:
            return f"执行失败: {e}"

    # ---- 工具定义 (OpenAI function calling 格式) ----

    TOOLS = [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "搜索互联网获取最新信息。输入查询关键词，返回搜索结果摘要。",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "搜索关键词"}},
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "file_read",
                "description": "读取本地文件内容",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "文件路径"}},
                    "required": ["path"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "file_write",
                "description": "写入内容到本地文件",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径"},
                        "content": {"type": "string", "description": "要写入的内容"},
                    },
                    "required": ["path", "content"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "sandbox_exec_python",
                "description": "执行 Python 代码并返回输出",
                "parameters": {
                    "type": "object",
                    "properties": {"code": {"type": "string", "description": "Python 代码"}},
                    "required": ["code"],
                },
            },
        },
    ]

    # ---- 构建消息 ----

    sys_prompt = agent.get("system_prompt") or (
        f"你是 {agent['name']} agent。{agent.get('description', '')}\n\n"
        "你可以使用工具来完成任务。在给出最终回答前，先用工具收集必要的信息。"
    )
    messages: list[dict] = [{"role": "system", "content": sys_prompt}]
    if ctx.get("history") and isinstance(ctx["history"], list):
        messages.extend(ctx["history"])
    if ctx.get("taskId"):
        messages.append({"role": "system", "content": f"当前任务ID: {ctx['taskId']}"})
    messages.append({"role": "user", "content": inp})

    # ---- Agent Loop ----

    total_tokens = {"prompt": 0, "completion": 0}
    final_output = ""
    tool_calls_made: list[str] = []

    for step in range(max_steps):
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=agent.get("temperature", 0.3),
                tools=TOOLS,
                tool_choice="auto",
            )
        except Exception as e:
            logger.warning("LLM call failed at step %d: %s", step, e)
            break

        choice = resp.choices[0]
        if resp.usage:
            total_tokens["prompt"] += resp.usage.prompt_tokens
            total_tokens["completion"] += resp.usage.completion_tokens

        msg = choice.message

        # 如果没有 tool_calls，说明 LLM 完成推理
        if not msg.tool_calls:
            final_output = msg.content or ""
            messages.append({"role": "assistant", "content": final_output})
            break

        # 处理 tool_calls
        assistant_msg: dict = {"role": "assistant", "content": msg.content or "", "tool_calls": []}
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            try:
                args = _json.loads(tc.function.arguments)
            except _json.JSONDecodeError:
                args = {}

            # 执行工具
            if tool_name == "web_search":
                result = await _web_search(args.get("query", ""))
            elif tool_name == "file_read":
                result = await _file_read(args.get("path", ""))
            elif tool_name == "file_write":
                result = await _file_write(args.get("path", ""), args.get("content", ""))
            elif tool_name == "sandbox_exec_python":
                result = await _sandbox_exec_python(args.get("code", ""))
            else:
                result = f"未知工具: {tool_name}"

            tool_calls_made.append(f"{tool_name}({str(args)[:50]})")
            assistant_msg["tool_calls"].append({
                "id": tc.id,
                "type": "function",
                "function": {"name": tool_name, "arguments": tc.function.arguments},
            })
            messages.append(assistant_msg)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        else:
            continue  # 所有 tool_calls 处理完，进入下一轮

    else:
        # 达到 max_steps，强制 LLM 给出最终回答
        messages.append({"role": "user", "content": "请基于以上所有收集到的信息，给出你的最终回答。"})
        try:
            resp = await client.chat.completions.create(
                model=model, messages=messages,
                temperature=agent.get("temperature", 0.3),
            )
            final_output = resp.choices[0].message.content or ""
            if resp.usage:
                total_tokens["prompt"] += resp.usage.prompt_tokens
                total_tokens["completion"] += resp.usage.completion_tokens
        except Exception:
            final_output = f"[{agent_id} 达到最大步数 {max_steps}，无最终输出]"

    return {
        "output": final_output,
        "agent": agent_id,
        "model": model,
        "steps": step + 1,
        "tool_calls": tool_calls_made,
        "tokens": total_tokens,
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
