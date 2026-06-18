#!/usr/bin/env python3
# deerflow/agents/dispatcher.py · Smart Dispatcher v1.0 (2026-06-17)
#
# 替代旧 Lead Agent 硬编码 5 步管道。
# 架构:
#   User Input → SmartDispatcher.classify() → route()
#     ├── simple       → 直接 LLM 回复
#     ├── web_search   → Researcher Agent
#     ├── content      → Writer Agent
#     ├── data         → Analyst Agent
#     ├── social       → Social Agent (微信/抖音/小红书)
#     ├── code         → Security Agent
#     └── complex      → Multi-Agent Orchestrator (自动规划+并发调度)

import asyncio
import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger("deerflow.agents.dispatcher")

# 短小输入直接快速回复 (不调用 LLM 做分类，节省 token)
SIMPLE_THRESHOLD = 15  # <15 字视为简单查询

SIMPLE_GREETINGS = [
    "你好", "hi", "hello", "嘿", "在吗", "早上好", "晚安", "谢谢", "再见",
    "你是谁", "介绍一下", "你能做什么", "帮助", "help",
]

SYSTEM_PROMPT = """你是 DaShengOS 智能调度器。分析用户输入，输出 JSON 格式的任务分类。

分类规则:
- "simple": 问候、闲聊、简单问答（不需要子代理）
- "web_search": 需要搜索互联网、查资料、找信息
- "content": 需要写文章、生成文案、创作内容
- "data": 需要数据分析、统计、制表
- "social": 需要发布到社交媒体（微信/抖音/小红书）
- "code": 需要写代码、调试、审查
- "complex": 需要多个子代理协同完成（研究+分析+写作）

输出格式: {"task_type": "分类", "reason": "简短说明", "sub_agents": []}

如果任务复杂，在 sub_agents 里列出需要的子代理:
["researcher", "analyst", "writer", "quality", "security"] 的子集。

只输出 JSON，不要其他内容。"""


class SmartDispatcher:
    """智能任务分发器 — 替代旧 Lead Agent"""

    def __init__(self):
        self.api_key = (
            os.environ.get("OPENAI_API_KEY")
            or os.environ.get("SILICONFLOW_API_KEY")
            or os.environ.get("DEEPSEEK_API_KEY")
        )
        self.base_url = os.environ.get("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1")
        self.model = os.environ.get("SILICONFLOW_DEFAULT_MODEL", "Qwen/Qwen2.5-72B-Instruct")

    # ===== 分类 =====

    def _quick_classify(self, query: str) -> str:
        """快速规则分类：极短输入/问候 → 不浪费 token 调 LLM"""
        q = query.strip().lower()
        if len(q) < SIMPLE_THRESHOLD:
            return "simple"
        for g in SIMPLE_GREETINGS:
            if g in q:
                return "simple"
        return "needs_llm"  # 需要 LLM 进一步分类

    async def _llm_classify(self, query: str) -> dict:
        """调 LLM 做任务分类"""
        if not self.api_key:
            return {"task_type": "simple", "reason": "no LLM key", "sub_agents": []}

        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/chat/completions",
                    json={
                        "model": self.model,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": query},
                        ],
                        "max_tokens": 128,
                        "temperature": 0.1,
                    },
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status != 200:
                        return {"task_type": "simple", "reason": f"LLM error {resp.status}", "sub_agents": []}
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    # 尝试解析 JSON
                    try:
                        return json.loads(content)
                    except json.JSONDecodeError:
                        # 可能返回了非 JSON，提取关键词
                        if "简单" in content or "simple" in content.lower():
                            return {"task_type": "simple", "reason": "fallback", "sub_agents": []}
                        if "搜索" in content or "search" in content.lower():
                            return {"task_type": "web_search", "reason": "fallback", "sub_agents": ["researcher"]}
                        if "创作" in content or "写" in content or "content" in content.lower():
                            return {"task_type": "content", "reason": "fallback", "sub_agents": ["writer"]}
                        return {"task_type": "complex", "reason": "fallback", "sub_agents": ["researcher", "writer"]}
        except Exception as e:
            logger.error("[dispatcher] LLM classify failed: %s", e)
            # 兜底：长文本→ research，短文本→ simple
            if len(query) > 100:
                return {"task_type": "complex", "reason": "fallback long query", "sub_agents": ["researcher", "writer"]}
            return {"task_type": "simple", "reason": "fallback", "sub_agents": []}

    # ===== 路由 =====

    async def handle(
        self,
        query: str,
        task_id: str,
        tasks: dict,
        locks: dict,
    ) -> None:
        """主入口 — 分类 → 路由 → 执行"""
        t = tasks[task_id]
        lock = locks[task_id]

        async with lock:
            t0 = time.time()
            try:
                # Step 1: 分类
                t["status"] = "classifying"
                t["progress"] = 5
                t["currentStep"] = "analyzing task..."
                t["updated_at"] = int(time.time() * 1000)

                quick = self._quick_classify(query)
                if quick != "needs_llm":
                    classification = {"task_type": quick, "reason": "quick rule", "sub_agents": []}
                else:
                    classification = await self._llm_classify(query)

                task_type = classification.get("task_type", "simple")
                sub_agents = classification.get("sub_agents", [])
                reason = classification.get("reason", "")
                logger.info("[%s] classified: %s (reason: %s, subs: %s)", task_id, task_type, reason, sub_agents)

                t["events"].append({
                    "type": "classified",
                    "ts": int(time.time() * 1000),
                    "task_type": task_type,
                    "reason": reason,
                })

                # Step 2: 按类型路由
                if task_type == "simple":
                    await self._handle_simple(query, t, task_id)
                elif task_type == "web_search":
                    await self._delegate_single("researcher", query, t, task_id)
                elif task_type == "content":
                    await self._delegate_single("writer", query, t, task_id)
                elif task_type == "data":
                    await self._delegate_single("analyst", query, t, task_id)
                elif task_type == "code":
                    await self._delegate_single("security_reviewer", query, t, task_id)
                elif task_type == "social":
                    await self._handle_social(query, t, task_id)
                elif task_type == "complex":
                    await self._orchestrate(query, sub_agents, t, task_id)
                else:
                    # 未知类型 → 当 simple 处理
                    await self._handle_simple(query, t, task_id)

                t["progress"] = 100
                t["status"] = "completed"
                t["updated_at"] = int(time.time() * 1000)
                t["events"].append({"type": "completed", "ts": t["updated_at"], "duration_s": time.time() - t0})

            except Exception as e:
                logger.exception("[%s] dispatcher failed", task_id)
                t["status"] = "error"
                t["error"] = f"{type(e).__name__}: {e}"
                t["updated_at"] = int(time.time() * 1000)

    # ===== Handlers =====

    async def _handle_simple(self, query: str, t: dict, task_id: str):
        """简单查询 — 直接 LLM 回复"""
        t["status"] = "answering"
        t["currentStep"] = "quick reply..."
        t["progress"] = 30
        t["updated_at"] = int(time.time() * 1000)

        answer = await self._llm_chat(query, max_tokens=512)
        t["report"] = answer
        t["sources"] = []
        t["artifacts"] = [{"type": "quick_reply", "mode": "direct"}]

    async def _delegate_single(self, agent: str, query: str, t: dict, task_id: str):
        """委托单个子代理"""
        t["status"] = "running"
        t["currentStep"] = f"delegating to {agent}..."
        t["progress"] = 30
        t["updated_at"] = int(time.time() * 1000)
        t["events"].append({"type": "delegate", "ts": t["updated_at"], "agent": agent})

        from . import run_sub_agent
        result = await run_sub_agent(agent, query, {"taskId": task_id})
        output = result.get("output", "") if isinstance(result, dict) else str(result)
        t["report"] = output
        t["sources"] = [agent]
        t["artifacts"] = [{"type": f"{agent}_output", "data": output[:2000]}]

    async def _handle_social(self, query: str, t: dict, task_id: str):
        """社媒任务 — 需要走 social agent API"""
        t["status"] = "running"
        t["currentStep"] = "preparing social post..."
        t["progress"] = 30
        t["updated_at"] = int(time.time() * 1000)

        # 先让 writer 生成内容
        from . import run_sub_agent
        content_result = await run_sub_agent("writer", f"生成一篇社媒文案: {query}", {"taskId": task_id})
        content = content_result.get("output", "") if isinstance(content_result, dict) else str(content_result)

        t["report"] = content
        t["sources"] = ["writer"]
        t["artifacts"] = [
            {"type": "social_draft", "data": content[:2000]},
            {"type": "social_publish_note", "data": "发布需配置社媒 worker (doyin-bridge/wechat-mp-bridge) 和有效 cookie"},
        ]

    async def _orchestrate(self, query: str, sub_agents: list, t: dict, task_id: str):
        """复杂任务 — 多 Agent 编排"""
        if not sub_agents:
            sub_agents = ["researcher", "writer"]

        t["status"] = "orchestrating"
        t["currentStep"] = f"coordinating {len(sub_agents)} agents: {', '.join(sub_agents)}"
        t["progress"] = 20
        t["updated_at"] = int(time.time() * 1000)
        t["events"].append({"type": "orchestrate", "ts": t["updated_at"], "agents": sub_agents})

        from . import run_sub_agent

        # 阶段 1: 研究阶段 (并行 researcher + analyst)
        research_inputs = []
        for agent in sub_agents:
            if agent in ("researcher", "analyst", "security_reviewer"):
                research_inputs.append(agent)

        findings = {}
        if research_inputs:
            t["currentStep"] = f"research phase: {len(research_inputs)} agents"
            t["progress"] = 40
            t["updated_at"] = int(time.time() * 1000)
            results = await asyncio.gather(*[
                run_sub_agent(a, f"研究任务: {query}", {"taskId": task_id})
                for a in research_inputs
            ], return_exceptions=True)
            for agent, result in zip(research_inputs, results):
                if isinstance(result, Exception):
                    findings[agent] = f"Error: {result}"
                else:
                    findings[agent] = result.get("output", "") if isinstance(result, dict) else str(result)

        # 阶段 2: 写作阶段
        if "writer" in sub_agents:
            t["currentStep"] = "writing phase..."
            t["progress"] = 70
            t["updated_at"] = int(time.time() * 1000)

            writer_prompt = f"整合以下研究发现，生成完整报告:\n\n用户问题: {query}\n\n研究发现:\n{findings}"
            writer_result = await run_sub_agent("writer", writer_prompt, {"taskId": task_id})
            t["report"] = writer_result.get("output", "") if isinstance(writer_result, dict) else str(writer_result)
        else:
            t["report"] = str(findings)

        # 阶段 3: 质量审查 (如果有 quality)
        if "quality_reviewer" in sub_agents:
            t["currentStep"] = "quality review..."
            t["progress"] = 90
            t["updated_at"] = int(time.time() * 1000)
            qa_result = await run_sub_agent(
                "quality_reviewer",
                f"审查以下报告:\n{t['report']}",
                {"taskId": task_id},
            )
            t["artifacts"] = [
                {"type": "findings", "data": {k: str(v)[:500] for k, v in findings.items()}},
                {"type": "quality_review", "data": str(qa_result)[:1000]},
            ]
        else:
            t["artifacts"] = [{"type": "findings", "data": {k: str(v)[:500] for k, v in findings.items()}}]

    # ===== LLM Helpers =====

    async def _llm_chat(self, query: str, max_tokens: int = 512) -> str:
        """直接 LLM 对话 (不走子代理)"""
        if not self.api_key:
            return "你好！我是 DaShengOS 智能工作台助手。当前 AI 引擎未配置，请联系管理员配置 API Key。"

        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/chat/completions",
                    json={
                        "model": self.model,
                        "messages": [
                            {"role": "system", "content": "你是 DaShengOS 智能工作台助手。你是品牌「爱尤趣」(情趣娃娃)的专属 AI。回复简洁、专业、友好。支持中文。"},
                            {"role": "user", "content": query},
                        ],
                        "max_tokens": max_tokens,
                        "temperature": 0.7,
                    },
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status != 200:
                        return f"AI 引擎返回错误 (HTTP {resp.status})，请稍后重试。"
                    data = await resp.json()
                    return data["choices"][0]["message"]["content"]
        except Exception as e:
            logger.error("[dispatcher] LLM chat failed: %s", e)
            return f"AI 引擎暂时不可用: {str(e)[:100]}"


# 单例
_dispatcher: SmartDispatcher | None = None

def get_dispatcher() -> SmartDispatcher:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = SmartDispatcher()
    return _dispatcher
