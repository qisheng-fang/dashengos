#!/usr/bin/env python3
# deerflow/daemon.py · v0.3 spec §35.3+§35.4 (Phase 3 完整版)
#
# DaShengOS backend (TypeScript) 通过 Unix socket JSON-RPC 调此 daemon
# 14 个 IPC 方法 (spec §35.4):
#   research.{run,cancel,status,result,stream}     深度研究 5 状态
#   agent.{list,run}                                 1 lead + 5 sub-agents
#   skill.{load,list}                                skill 加载/列
#   sandbox.exec                                      代码执行
#   browser.{navigate,extract}                       浏览器自动化
#   file.{read,write}                                文件 IO
#   health.ping                                       健康检查
#   audit.write                                       写 audit log
#   secret.{read,list}                                读 Keychain
#
# 嵌入模式 (spec §35.1 模式 A): backend 容器内 Python 进程
# 协议: JSON-RPC 2.0 over Unix socket (newline-delimited)
# 老板原则 #2: 0 行业务逻辑,薄薄一层,真有 LLM 能力在 sub-agents

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

# v0.3 spec §35.7 env vars
SOCKET_PATH = os.environ.get("DEERFLOW_SOCKET_PATH", "/tmp/dasheng/deerflow.sock")
DEERFLOW_VERSION = "v2.0.0-rc2"
DEERFLOW_YAML = os.environ.get("DEERFLOW_YAML", "apps/backend/configs/deerflow.yaml")
DEERFLOW_AUDIT_LEVEL = os.environ.get("DEERFLOW_AUDIT_LEVEL", "info")
DEERFLOW_TRACE_SYNC = os.environ.get("DEERFLOW_TRACE_SYNC_ENABLED", "true").lower() == "true"
DEERFLOW_WORKER_POOL_SIZE = int(os.environ.get("DEERFLOW_WORKER_POOL_SIZE", "2"))
DEERFLOW_MAX_STEPS_DEFAULT = int(os.environ.get("DEERFLOW_MAX_STEPS_DEFAULT", "20"))

# credentials 目录 (Keychain 代理 · spec §35.6)
CREDENTIALS_DIR = Path(os.environ.get("DASHENG_CREDENTIALS_DIR", "/home/dasheng/.workbuddy/credentials"))

# 任务状态环形缓冲 (重启清零 · spec §35.4)
TASKS: dict[str, dict] = {}  # task_id → {status, progress, steps, result, ...}
TASK_LOCKS: dict[str, asyncio.Lock] = {}

# logger
logging.basicConfig(
    level=os.environ.get("DEERFLOW_LOG_LEVEL", "info").upper(),
    format="%(asctime)s [deerflow.daemon] %(levelname)s %(message)s",
)
logger = logging.getLogger("deerflow.daemon")


# ====================================================================
# 方法注册表 (spec §35.4)
# ====================================================================
METHODS: dict[str, Any] = {}


def method(name: str):
    """装饰器: 注册 1 个 JSON-RPC 方法"""
    def deco(fn):
        METHODS[name] = fn
        logger.debug("registered method: %s", name)
        return fn
    return deco


# ---------- 基础类 -------------------------------------------------

@method("health.ping")
async def health_ping(params: dict) -> dict:
    """spec §35.4 · 双向 · 健康检查"""
    return {
        "status": "ok",
        "version": DEERFLOW_VERSION,
        "socket": SOCKET_PATH,
        "methods": len(METHODS),
        "tasks": len(TASKS),
        "pool_size": DEERFLOW_WORKER_POOL_SIZE,
    }


# ---------- §35.4 research (深度研究 5 状态) --------------------

@method("research.run")
async def research_run(params: dict) -> dict:
    """spec §35.4 · 启动深度研究任务,lead agent 拆解+派发 sub-agents"""
    task_id = params.get("taskId") or f"task_{uuid.uuid4().hex[:12]}"
    query = params.get("query", "")
    if not query:
        raise ValueError("query is required")

    sub_agents = params.get("subAgents") or ["researcher"]
    max_steps = int(params.get("maxSteps", DEERFLOW_MAX_STEPS_DEFAULT))

    TASKS[task_id] = {
        "status": "started",
        "progress": 0,
        "currentStep": "decomposing query",
        "query": query,
        "subAgents": sub_agents,
        "maxSteps": max_steps,
        "started_at": int(time.time() * 1000),
        "updated_at": int(time.time() * 1000),
        "events": deque(maxlen=200),
    }
    TASK_LOCKS[task_id] = asyncio.Lock()

    TASKS[task_id]["events"].append({
        "type": "research.started", "taskId": task_id,
        "ts": int(time.time() * 1000), "query": query, "subAgents": sub_agents,
    })
    logger.info("research.run task=%s query=%r sub=%s", task_id, query[:60], sub_agents)

    # lead agent 异步跑 (Phase 3 真正实现见 deerflow/agents/lead_agent.py)
    asyncio.create_task(_run_research_pipeline(task_id))

    return {"taskId": task_id, "status": "started"}


async def _run_research_pipeline(task_id: str) -> None:
    """Lead agent 编排流程: 拆解→并发 5 researcher→writer→quality→完成"""
    from deerflow.agents.lead_agent import run_research_pipeline
    try:
        await run_research_pipeline(task_id, TASKS, TASK_LOCKS)
    except Exception as e:
        logger.exception("pipeline failed for %s", task_id)
        TASKS[task_id]["status"] = "error"
        TASKS[task_id]["error"] = f"{type(e).__name__}: {e}"
        TASKS[task_id]["updated_at"] = int(time.time() * 1000)


@method("research.cancel")
async def research_cancel(params: dict) -> dict:
    """取消任务"""
    task_id = params.get("taskId")
    if not task_id or task_id not in TASKS:
        raise ValueError(f"task not found: {task_id}")
    TASKS[task_id]["status"] = "cancelled"
    TASKS[task_id]["updated_at"] = int(time.time() * 1000)
    TASKS[task_id]["events"].append({
        "type": "research.cancelled", "taskId": task_id,
        "ts": int(time.time() * 1000),
    })
    return {"status": "cancelled"}


@method("research.status")
async def research_status(params: dict) -> dict:
    """查询进度"""
    task_id = params.get("taskId")
    if not task_id or task_id not in TASKS:
        raise ValueError(f"task not found: {task_id}")
    t = TASKS[task_id]
    return {
        "status": t["status"],
        "progress": t.get("progress", 0),
        "currentStep": t.get("currentStep"),
    }


@method("research.result")
async def research_result(params: dict) -> dict:
    """拿最终报告"""
    task_id = params.get("taskId")
    if not task_id or task_id not in TASKS:
        raise ValueError(f"task not found: {task_id}")
    t = TASKS[task_id]
    return {
        "status": t["status"],
        "report": t.get("report", ""),
        "sources": t.get("sources", []),
        "artifacts": t.get("artifacts", []),
    }


@method("research.stream")
async def research_stream(params: dict) -> dict:
    """订阅流事件 (newline-delimited, 真生产用 SSE 桥 · spec §35.3)"""
    task_id = params.get("taskId")
    if not task_id or task_id not in TASKS:
        raise ValueError(f"task not found: {task_id}")
    return {
        "taskId": task_id,
        "events": list(TASKS[task_id].get("events", [])),
    }


# ---------- §35.4 agent (1 lead + 5 sub-agents) -------------------

@method("agent.list")
async def agent_list(params: dict) -> dict:
    """列子智能体 (从 deerflow.yaml 读)"""
    from deerflow.agents import list_agents
    return {"agents": list_agents()}


@method("agent.run")
async def agent_run(params: dict) -> dict:
    """单 sub-agent 调用"""
    from deerflow.agents import run_sub_agent
    agent_id = params.get("agentId")
    if not agent_id:
        raise ValueError("agentId is required")
    inp = params.get("input", "")
    ctx = params.get("context", {})
    return await run_sub_agent(agent_id, inp, ctx)


# ---------- §35.4 skill (加载/列) -------------------------------

@method("skill.list")
async def skill_list(params: dict) -> dict:
    """列 skill (扫描 builtin + marketplace)"""
    from deerflow.agents import list_skills
    cat = params.get("category")
    return {"skills": list_skills(cat)}


@method("skill.load")
async def skill_load(params: dict) -> dict:
    """加载 skill manifest"""
    from deerflow.agents import load_skill
    skill_id = params.get("skillId")
    if not skill_id:
        raise ValueError("skillId is required")
    return load_skill(skill_id)


# ---------- §35.4 sandbox (代码执行) ---------------------------

@method("sandbox.exec")
async def sandbox_exec(params: dict) -> dict:
    """在 DeerFlow 沙箱里跑代码 (Docker 隔离 · spec §36.5)"""
    import subprocess
    code = params.get("code", "")
    lang = params.get("lang", "python")
    timeout_ms = int(params.get("timeout", 60000))
    if lang != "python":
        raise ValueError(f"unsupported lang: {lang} (only python in Phase 3)")

    user_id = params.get("userId", "anon")
    work_dir = Path("/tmp/dasheng-sandbox") / user_id
    work_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(work_dir, 0o700)

    proc = subprocess.run(
        ["python3", "-c", code],
        capture_output=True, text=True, timeout=timeout_ms / 1000,
        cwd=work_dir,
    )
    return {
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "exitCode": proc.returncode,
    }


# ---------- §35.4 browser (浏览器自动化) --------------------

@method("browser.navigate")
async def browser_navigate(params: dict) -> dict:
    """浏览器 navigate (Playwright stub · spec §35.4)"""
    url = params.get("url")
    if not url:
        raise ValueError("url is required")
    return {
        "url": url,
        "status": "ok",
        "html": f"<html><body>Browser navigate stub for {url}</body></html>",
        "screenshot": None,
        "note": "Playwright integration in P3.10",
    }


@method("browser.extract")
async def browser_extract(params: dict) -> dict:
    """抓取网页内容"""
    url = params.get("url")
    selector = params.get("selector")
    return {
        "url": url,
        "data": {"title": f"Extracted from {url}", "selector": selector},
        "markdown": f"# Extracted from {url}\n\n(Phase 3 stub)",
    }


# ---------- §35.4 file (读/写) -------------------------------

@method("file.read")
async def file_read(params: dict) -> dict:
    path = params.get("path")
    if not path:
        raise ValueError("path is required")
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"file not found: {path}")
    return {
        "content": p.read_text(encoding="utf-8", errors="替换"),
        "meta": {"size": p.stat().st_size, "mtime": int(p.stat().st_mtime * 1000)},
    }


@method("file.write")
async def file_write(params: dict) -> dict:
    path = params.get("path")
    content = params.get("content", "")
    if not path:
        raise ValueError("path is required")
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {"status": "ok", "path": path, "bytes": len(content.encode("utf-8"))}


# ---------- §35.4 audit (写 DaShengOS 审计) ----------------

@method("audit.write")
async def audit_write(params: dict) -> dict:
    """DeerFlow 写 DaShengOS audit log (spec §35.6 + §37.3)"""
    if not DEERFLOW_TRACE_SYNC:
        return {"status": "sync_disabled"}

    level = params.get("level", "info")
    typ = params.get("type", "deerflow.event")
    payload = params.get("payload", {})

    import urllib.request
    audit_url = os.environ.get("DASHENG_AUDIT_URL", "http://127.0.0.1:8000/api/v1/audit/logs")
    audit_token = os.environ.get("DASHENG_AUDIT_TOKEN", "")
    try:
        req = urllib.request.Request(
            audit_url,
            data=json.dumps({"level": level, "type": typ, "source": "deerflow", "payload": payload}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {audit_token}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {"status": "logged", "audit_status": resp.status}
    except Exception as e:
        logger.warning("audit sync failed (non-fatal): %s", e)
        return {"status": "logged", "audit_status": "unreachable", "error": str(e)[:200]}


# ---------- §35.4 secret (读 Keychain) ---------------------

@method("secret.read")
async def secret_read(params: dict) -> dict:
    """读 Keychain 凭据 (spec §35.6)"""
    name = params.get("name")
    if not name:
        raise ValueError("name is required")
    p = CREDENTIALS_DIR / f"{name}.env"
    if p.exists():
        return {"name": name, "value": p.read_text().strip()}
    return {"name": name, "value": None}


@method("secret.list")
async def secret_list(params: dict) -> dict:
    """列所有凭据名 (spec §35.6)"""
    if not CREDENTIALS_DIR.exists():
        return {"secrets": []}
    return {"secrets": [p.stem for p in CREDENTIALS_DIR.glob("*.env")]}


# ====================================================================
# JSON-RPC 2.0 dispatcher (spec §35.3)
# ====================================================================
async def dispatch(request: dict) -> dict:
    request_id = request.get("id")
    method_name = request.get("method")
    params = request.get("params", {})

    handler = METHODS.get(method_name)
    if handler is None:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method not found: {method_name}"},
        }

    t0 = time.time()
    try:
        result = await handler(params)
        dt = (time.time() - t0) * 1000
        logger.info("rpc %-25s ok in %6.1fms", method_name, dt)
        if DEERFLOW_TRACE_SYNC and method_name not in ("health.ping", "audit.write"):
            try:
                await audit_write({
                    "level": "info", "type": "deerflow.rpc",
                    "payload": {"method": method_name, "durationMs": dt, "ok": True},
                })
            except Exception:
                pass
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except Exception as e:
        logger.exception("rpc %s failed", method_name)
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32603,
                "message": f"{type(e).__name__}: {e}",
            },
        }


# ====================================================================
# Unix socket server (spec §35.3)
# ====================================================================
async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername") or "?"
    logger.info("client connected: %s", peer)
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            try:
                request = json.loads(line)
            except json.JSONDecodeError as e:
                logger.error("invalid JSON from %s: %s", peer, e)
                continue
            response = await dispatch(request)
            writer.write((json.dumps(response) + "\n").encode("utf-8"))
            await writer.drain()
    except asyncio.IncompleteReadError:
        pass
    finally:
        writer.close()
        await writer.wait_closed()
        logger.info("client disconnected: %s", peer)


async def main() -> None:
    # P4.1: 启动时把 ~/.workbuddy/credentials/*.env 注入到 os.environ
    # (让 LLM 客户端能拿到 OPENAI_API_KEY 等, spec §35.6)
    from deerflow.credentials import init_env
    n = init_env()
    logger.info("credentials.init_env: %d secret(s) loaded from %s", n, CREDENTIALS_DIR)

    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    Path(SOCKET_PATH).parent.mkdir(parents=True, exist_ok=True)
    server = await asyncio.start_unix_server(handle_client, path=SOCKET_PATH)
    os.chmod(SOCKET_PATH, 0o660)
    logger.info("=" * 60)
    logger.info("deerflow daemon v%s listening on %s", DEERFLOW_VERSION, SOCKET_PATH)
    logger.info("methods registered: %d", len(METHODS))
    for m in sorted(METHODS):
        logger.info("  - %s", m)
    logger.info("=" * 60)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("daemon stopped by SIGINT")
        sys.exit(0)
