#!/usr/bin/env python3
# deerflow/agents/lead_agent.py · v0.3 spec §36.1 lead_agent
#
# Lead agent · 任务分发 + 汇总 (Phase 3 简化版)
# 老板原则 #2: 0 行业务逻辑,薄薄一层
# 真 LLM 能力通过 DaShengOS backend (existing :8000) 调度
#
# Track C.1 (2026-06-17): 加 quick-classify 门禁
#   简单查询 (问候/闲聊/事实问答) → 直接 LLM 回复，不走子代理管道
#   复杂查询 (研究/创作/分析) → 完整 5 步管道

import asyncio
import logging
import os
import time
from typing import Any

# TASKS / TASK_LOCKS 来自 deerflow.daemon (不是 agents 包)
# lead_agent 是从 daemon 调过来的,参数收 (TASKS, TASK_LOCKS),不需在这里 import

logger = logging.getLogger("deerflow.agents.lead")

# Simple query patterns — 无需走完整管道的关键词/意图
SIMPLE_PATTERNS = [
    "你好", "谢谢", "再见", "早上好", "晚安",
    "你是谁", "介绍一下自己", "你能做什么",
    "hi", "hello", "hey",
]

def _is_simple_query(query: str) -> bool:
    """快速判断是否是简单查询 (不调 LLM, 纯规则)"""
    q = query.strip().lower()
    # 极短输入 (<15 字) → 大概率是简单问题
    if len(q) < 15:
        return True
    # 匹配已知简单模式
    for p in SIMPLE_PATTERNS:
        if p in q:
            return True
    # 纯标点/表情 → 简单
    if all(c in "，。！？…～😊😂👍❤️🙏🎉💪🔥👏" for c in q.replace(" ", "")):
        return True
    return False

async def _quick_answer(query: str, max_tokens: int = 256) -> str:
    """简单查询直接用 LLM 回复，不走子代理管道"""
    api_key = (
        os.environ.get("OPENAI_API_KEY")
        or os.environ.get("SILICONFLOW_API_KEY")
        or os.environ.get("DEEPSEEK_API_KEY")
    )
    base_url = os.environ.get("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1")
    model = os.environ.get("SILICONFLOW_DEFAULT_MODEL", "Qwen/Qwen2.5-72B-Instruct")

    if not api_key:
        logger.warning("[quick-answer] No LLM key, returning fallback")
        return "你好！我是 DaShengOS 工作台助手。请问有什么可以帮你的？"

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是 DaShengOS 工作台助手。简洁友好地回复用户。"},
                        {"role": "user", "content": query},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": 0.7,
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    logger.error("[quick-answer] LLM error: %s", resp.status)
                    return "抱歉，AI 服务暂时不可用。请稍后重试。"
                data = await resp.json()
                return data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error("[quick-answer] Failed: %s", e)
        return "你好！我是 DaShengOS 工作台助手，目前 AI 引擎正在预热中。有什么需要帮忙的？"

async def run_research_pipeline(task_id: str, tasks: dict, locks: dict) -> None:
    """Lead agent 编排: 拆解→并发 5 researcher→writer→quality→完成
    spec §36.1 + §36.2 实战案例 1

    Args:
        task_id: 已创建的 task_id
        tasks: 任务状态 dict (TASKS)
        locks: 任务锁 dict (TASK_LOCKS)
    """
    t = tasks[task_id]
    lock = locks[task_id]
    query = t["query"]
    sub_agents = t["subAgents"]
    max_steps = t["maxSteps"]

    async with lock:
        try:
            # ===== Track C.1: Quick-classify gatekeeper =====
            # 简单查询 → 直接 LLM 回复，跳过子代理管道
            if _is_simple_query(query):
                t["status"] = "answering"
                t["progress"] = 20
                t["currentStep"] = "quick_answer"
                t["updated_at"] = int(time.time() * 1000)
                t["events"].append({"type": "step", "ts": t["updated_at"], "step": "quick-classify", "verdict": "simple"})
                logger.info("[%s] quick-answer mode (simple query: %s)", task_id, query[:50])

                answer = await _quick_answer(query)
                t["status"] = "completed"
                t["progress"] = 100
                t["currentStep"] = "done"
                t["report"] = answer
                t["sources"] = []
                t["artifacts"] = []
                t["updated_at"] = int(time.time() * 1000)
                t["events"].append({"type": "research.completed", "taskId": task_id, "ts": t["updated_at"], "mode": "quick"})
                logger.info("[%s] quick-answer completed · len=%d", task_id, len(answer))
                return

            # ===== 完整管道: 复杂查询 =====
            t["events"].append({"type": "step", "ts": int(time.time() * 1000), "step": "quick-classify", "verdict": "complex"})
            logger.info("[%s] full pipeline mode (complex query: %s)", task_id, query[:50])

            # 阶段 1: 任务拆解 (Phase 3 简化: 直接用 subAgents 列表, 真实用 LLM 拆)
            t["status"] = "decomposing"
            t["progress"] = 5
            t["currentStep"] = "decomposing query into subtasks"
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "step", "ts": t["updated_at"], "step": "decompose", "subtasks": len(sub_agents)})
            logger.info("[%s] decomposing: %d sub-agents", task_id, len(sub_agents))
            await asyncio.sleep(0.1)

            # 阶段 2: 并发调 sub-agents (spec §36.5 隔离)
            t["status"] = "researching"
            t["progress"] = 20
            t["currentStep"] = f"dispatching {len(sub_agents)} sub-agents"
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "step", "ts": t["updated_at"], "step": "dispatch", "subagents": sub_agents})

            from . import run_sub_agent
            findings = await asyncio.gather(*[
                run_sub_agent(sub, query, {"taskId": task_id})
                for sub in sub_agents
            ], return_exceptions=True)

            t["progress"] = 70
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "step", "ts": t["updated_at"], "step": "sub-agents done", "count": len(findings)})
            logger.info("[%s] sub-agents done: %d findings", task_id, len(findings))

            # 阶段 3: writer 整合
            t["status"] = "writing"
            t["currentStep"] = "writer consolidating report"
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "step", "ts": t["updated_at"], "step": "writer"})
            writer_result = await run_sub_agent("writer", _build_writer_prompt(query, findings), {"taskId": task_id})

            t["progress"] = 90
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "step", "ts": t["updated_at"], "step": "quality-review"})

            # 阶段 4: quality_review
            t["status"] = "reviewing"
            t["currentStep"] = "quality reviewer checking"
            t["updated_at"] = int(time.time() * 1000)
            quality = await run_sub_agent("quality_reviewer", _build_qa_prompt(writer_result), {"taskId": task_id})

            # 阶段 5: 完成
            t["status"] = "completed"
            t["progress"] = 100
            t["currentStep"] = "done"
            t["report"] = writer_result.get("output", "")
            t["sources"] = []
            t["artifacts"] = [
                {"type": "sub_agent_findings", "data": [f if not isinstance(f, Exception) else str(f) for f in findings]},
                {"type": "quality_review", "data": quality.get("output", "")[:1000]},
            ]
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "research.completed", "taskId": task_id, "ts": t["updated_at"]})
            logger.info("[%s] completed · writer_output_len=%d · findings_count=%d",
                        task_id, len(t["report"]), len(findings))
            logger.info("[%s] writer_result.keys=%s · output_preview=%r",
                        task_id, list(writer_result.keys()) if isinstance(writer_result, dict) else type(writer_result).__name__,
                        t["report"][:200])

        except Exception as e:
            logger.exception("[%s] pipeline failed", task_id)
            t["status"] = "error"
            t["error"] = f"{type(e).__name__}: {e}"
            t["updated_at"] = int(time.time() * 1000)
            t["events"].append({"type": "research.error", "ts": t["updated_at"], "error": str(e)[:200]})


def _build_writer_prompt(query: str, findings: list) -> str:
    return (
        f"你是 Writer agent. 用户问题: {query}\n\n"
        f"上游 sub-agents 找到的资料:\n{findings}\n\n"
        f"整合成一篇结构化报告,带数据来源引用。\n"
        f"格式:\n# 标题\n## 章节 1\n[1] 来源\n..."
    )


def _build_qa_prompt(writer_result: dict) -> str:
    return (
        "你是 Quality Reviewer. 检查以下报告的事实准确性 + 逻辑一致性:\n\n"
        f"{writer_result.get('output', '')}\n\n"
        "输出格式:\n## 通过项\n- ...\n## 问题项\n- ...\n## 改进建议\n- ..."
    )
