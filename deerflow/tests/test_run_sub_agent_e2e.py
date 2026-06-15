#!/usr/bin/env python3
"""E2E test: run_sub_agent 真接 SiliconFlow Qwen2.5-72B (P4.1 修复验证)

跑前准备 (任选其一):
  1) export OPENAI_API_KEY=sk-...
  2) 把 key 放 ~/.workbuddy/credentials/OPENAI_API_KEY.env
     (daemon 启动时 init_env() 会自动 inject 到 os.environ)

跑法:
  cd /Users/apple/Desktop/ai-workbench-v2
  python -m deerflow.tests.test_run_sub_agent_e2e
  # 或: python deerflow/tests/test_run_sub_agent_e2e.py

期望输出: writer + researcher 都返真实文本（不是 [agent stub]），含 model + tokens
返 0 = PASS, 返 1 = FAIL
"""
import asyncio
import os
import sys
import time
from pathlib import Path

# 让 import deerflow.agents 能找到 (test 在子目录)
_PKG_PARENT = Path(__file__).resolve().parent.parent.parent
if str(_PKG_PARENT) not in sys.path:
    sys.path.insert(0, str(_PKG_PARENT))

from deerflow.agents import run_sub_agent, list_agents  # noqa: E402
from deerflow.credentials import init_env  # noqa: E402

# 先 inject credentials (跟 daemon 启动时一样)
_N_INJECTED = init_env()


async def main() -> int:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("SKIP: OPENAI_API_KEY not set (export it or 放 ~/.workbuddy/credentials/OPENAI_API_KEY.env)")
        return 0

    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")
    print(f"OPENAI_BASE_URL: {base_url}")
    print(f"credentials injected at startup: {_N_INJECTED}")
    print(f"Available agents: {[a['name'] for a in list_agents()]}")
    print()

    # 1) writer (最简 prompt, 应该 1-3s 出)
    print("=== writer ===")
    t0 = time.time()
    r = await run_sub_agent(
        "writer",
        "用 1 句话介绍 DaShengOS (中文, 30 字以内)",
        {"taskId": "smoke-writer-1"},
    )
    dt = time.time() - t0
    print(f"latency:  {dt:.2f}s")
    print(f"agent:    {r.get('agent')}")
    print(f"model:    {r.get('model')}")
    print(f"tokens:   {r.get('tokens')}")
    out = r.get("output", "")
    print(f"output:   {out[:300]}")
    if r.get("error"):
        print(f"ERROR:    {r['error']}")
        return 1
    assert r.get("output"), "empty output"
    assert r.get("model"), "no model in result"
    assert r.get("tokens"), "no token usage"
    assert not out.startswith("["), f"got stub output: {out[:80]}"
    print()

    # 2) researcher (default 工具链, 走纯 LLM 推理, 应该有内容)
    print("=== researcher ===")
    t0 = time.time()
    r = await run_sub_agent(
        "researcher",
        "列出 3 个最常见的 Python web 框架并各用 1 句话说明",
        {"taskId": "smoke-researcher-1"},
    )
    dt = time.time() - t0
    print(f"latency:  {dt:.2f}s")
    print(f"model:    {r.get('model')}")
    print(f"tokens:   {r.get('tokens')}")
    out = r.get("output", "")
    print(f"output:   {out[:300]}")
    if r.get("error"):
        print(f"ERROR:    {r['error']}")
        return 1
    assert r.get("output"), "empty output"
    assert not out.startswith("["), f"got stub output: {out[:80]}"
    print()

    # 3) analyst (data 推理)
    print("=== analyst ===")
    t0 = time.time()
    r = await run_sub_agent(
        "analyst",
        "1+1 等于几? 直接答数字。",
        {"taskId": "smoke-analyst-1"},
    )
    dt = time.time() - t0
    print(f"latency:  {dt:.2f}s")
    print(f"output:   {r.get('output', '')[:200]}")
    if r.get("error"):
        print(f"ERROR:    {r['error']}")
        return 1
    assert r.get("output"), "empty output"
    assert not r.get("output", "").startswith("["), "got stub output"
    print()

    print("✅ all agents 真接 LLM 通了 (writer + researcher + analyst)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
