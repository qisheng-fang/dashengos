#!/usr/bin/env python3
"""E2E test: DeerFlowBrain.stream() 真接 daemon + LLM (P4.2 验证)

跑前:
  1. 启 deerflow daemon: cd deerflow && python -m deerflow.daemon &
     (用刚 P4.1 修过的 daemon, 启动时自动 init_env 注入 keychain)
  2. set -a && source /Users/apple/.hermes/.env && set +a
     (拿到 SiliconFlow key)

跑法:
  cd /Users/apple/Desktop/ai-workbench-v2
  set -a && source /Users/apple/.hermes/.env && set +a
  /Users/apple/Desktop/DaShengOS\ 大师OS/backend/.venv/bin/python -m agent.tests.test_deerflow_brain_e2e

期望: RUN_STARTED → STATE_SNAPSHOT → TEXT_DELTA 真文本 → RUN_FINISHED 序列
返 0 = PASS, 返 1 = FAIL
"""
import asyncio
import os
import sys
import time
from pathlib import Path

# 让 import agent.* 能找到 (test 在子目录)
_PKG_PARENT = Path(__file__).resolve().parent.parent.parent
if str(_PKG_PARENT) not in sys.path:
    sys.path.insert(0, str(_PKG_PARENT))

from agent.brain_factory import create_brain  # noqa: E402
from agent.brain import AgentEventType, Message, MessageRole  # noqa: E402


async def main() -> int:
    # 先 inject credentials (跟 daemon 启动时一样)
    from deerflow.credentials import init_env
    n_inj = init_env()
    print(f"credentials injected: {n_inj}")

    if not os.environ.get("OPENAI_API_KEY"):
        print("SKIP: OPENAI_API_KEY not set")
        return 0

    sock = os.environ.get("DEERFLOW_SOCKET_PATH", "/tmp/dasheng/deerflow.sock")
    if not Path(sock).exists():
        print(f"SKIP: deerflow daemon socket not found: {sock}")
        print("     先启 daemon: python -m deerflow.daemon &")
        return 0

    print(f"daemon socket: {sock}")
    print(f"Creating DeerFlowBrain via brain_factory...")
    brain = create_brain(backend="deerflow")
    h = brain.health()
    print(f"health: {h}")
    assert h["daemon_connected"], "daemon socket exists but health says not connected"
    print()

    thread_id = f"t_smoke_{int(time.time())}"
    messages = [Message(
        id="m1",
        role=MessageRole.USER,
        content="用 1 句话介绍 DaShengOS",
    )]

    print(f"=== stream() (thread={thread_id}) ===")
    t0 = time.time()
    events = []
    async for ev in brain.stream(messages=messages, tools=None, thread_id=thread_id):
        events.append(ev)
        delta_preview = (ev.delta[:60] + "...") if ev.delta and len(ev.delta) > 60 else (ev.delta or "-")
        print(f"  event: {ev.type.name:20s} delta={delta_preview}")
    dt = time.time() - t0
    print(f"latency: {dt:.2f}s, events: {len(events)}")
    print()

    # 断言
    types = {e.type for e in events}
    if AgentEventType.RUN_STARTED not in types:
        print(f"FAIL: missing RUN_STARTED, got {types}")
        return 1
    if AgentEventType.RUN_FINISHED not in types:
        print(f"FAIL: missing RUN_FINISHED, got {types}")
        return 1

    text_events = [e for e in events if e.type == AgentEventType.TEXT_DELTA]
    if not text_events:
        print("FAIL: no TEXT_DELTA (no real LLM content)")
        return 1
    full_text = "".join(e.delta or "" for e in text_events)
    if not full_text:
        print("FAIL: empty full_text")
        return 1
    if full_text.startswith("["):
        print(f"FAIL: got stub text: {full_text[:80]}")
        return 1

    print(f"✅ full output: {full_text[:200]}")
    print()
    print("✅ DeerFlowBrain.stream() 真接 daemon + LLM 通了")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
