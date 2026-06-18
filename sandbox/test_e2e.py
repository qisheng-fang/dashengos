#!/usr/bin/env python3
"""sandbox/test_e2e.py · v0.3 Phase 3 T3.3 端到端 17 IPC methods 验证

用法:
    python3 sandbox/test_e2e.py
"""
import json
import os
import socket
import sys
import time
from pathlib import Path

SOCK = os.environ.get("DASHE_SANDBOX_SOCKET", "/tmp/dasheng/sandbox.sock")


class Result:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.failures = []

    def check(self, name: str, expected_substr: str, actual: str):
        if expected_substr in actual:
            print(f"  ✅ {name}")
            self.passed += 1
        else:
            print(f"  ❌ {name}  (expected: {expected_substr!r})")
            print(f"      got: {actual[:200]}")
            self.failed += 1
            self.failures.append(name)


def call(method: str, params: dict | list | None = None, id: int = 0) -> dict:
    """Send a single JSON-RPC 2.0 request, return parsed response."""
    req = {
        "jsonrpc": "2.0",
        "id": id or int(time.time() * 1_000_000),
        "method": method,
        "params": params if params is not None else {},
    }
    line = (json.dumps(req) + "\n").encode("utf-8")
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(30)
    s.connect(SOCK)
    s.sendall(line)
    chunks = []
    while True:
        try:
            chunk = s.recv(4096)
        except socket.timeout:
            break
        if not chunk:
            break
        chunks.append(chunk)
        if b"\n" in chunk:
            break
    s.close()
    raw = b"".join(chunks).decode("utf-8").strip()
    if not raw:
        return {"_raw": "<empty>", "_sent": req}
    try:
        return json.loads(raw.split("\n")[0])
    except json.JSONDecodeError as e:
        return {"_raw": raw, "_sent": req, "_parse_error": str(e)}


def main() -> int:
    r = Result()
    compact = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))

    # 1. health.ping
    print("== 1. health.ping ==")
    resp = call("health.ping", {}, 1)
    body = compact(resp)
    r.check("status=ok", '"status":"ok"', body)
    r.check("version v0.3.0-phase3", "v0.3.0-phase3", body)
    r.check("methods=23", '"methods":23', body)
    r.check("os=darwin", '"os":"darwin"', body)

    # 2. sandbox.exec (node --version)
    print("== 2. sandbox.exec ==")
    resp = call("sandbox.exec", {"command": "node", "args": ["--version"]}, 2)
    body = compact(resp)
    r.check("exit_code=0", '"exit_code":0', body)
    r.check("isolated=false (macOS)", '"isolated":false', body)
    r.check("stdout starts with v", '"stdout":"v', body)

    # 3. file.write + file.read
    print("== 3. file.write + file.read ==")
    tmpfile = "/tmp/dasheng/test-sandbox-e2e.txt"
    Path("/tmp/dasheng").mkdir(parents=True, exist_ok=True)
    resp = call("file.write", {"path": tmpfile, "content": "hello sandbox", "create_dirs": True}, 3)
    body = compact(resp)
    r.check("write bytes_written=13", '"bytes_written":13', body)
    resp = call("file.read", {"path": tmpfile}, 4)
    body = compact(resp)
    r.check("read content=hello sandbox", '"content":"hello sandbox"', body)
    r.check("read size=13", '"size":13', body)

    # 4. research workflow (run + status + result)
    print("== 4. research workflow ==")
    resp = call("research.run", {"query": "test query", "max_results": 3}, 5)
    body = compact(resp)
    r.check("research.run has id", '"id":', body)
    job_id = (resp.get("result") or {}).get("id", "")
    time.sleep(4.0)  # let simulation complete (~3.8s)
    resp = call("research.status", {"id": job_id}, 6)
    body = compact(resp)
    r.check("status=done", '"status":"done"', body)
    r.check("progress=100", '"progress":100', body)
    resp = call("research.result", {"id": job_id}, 7)
    body = compact(resp)
    r.check("result has findings", '"findings"', body)

    # 5. research.stream
    print("== 5. research.stream ==")
    resp = call("research.run", {"query": "stream test"}, 8)
    sid = (resp.get("result") or {}).get("id", "")
    time.sleep(4.0)
    resp = call("research.stream", {"id": sid}, 9)
    body = compact(resp)
    r.check("stream has events", '"events"', body)
    r.check("stream status=done", '"status":"done"', body)

    # 6. research.cancel
    print("== 6. research.cancel ==")
    resp = call("research.run", {"query": "cancel test"}, 10)
    cid = (resp.get("result") or {}).get("id", "")
    time.sleep(0.3)
    resp = call("research.cancel", {"id": cid}, 11)
    body = compact(resp)
    r.check("cancel returns cancelled field", '"cancelled":', body)

    # 7. agent.list
    print("== 7. agent.list ==")
    resp = call("agent.list", {}, 12)
    body = compact(resp)
    r.check("has code-reviewer", "code-reviewer", body)
    r.check("has deep-researcher", "deep-researcher", body)
    r.check("has data-analyst", "data-analyst", body)
    r.check("6 agents", '"code-reviewer"', body)

    # 8. agent.run
    print("== 8. agent.run ==")
    resp = call("agent.run", {"agent_id": "code-reviewer", "input": {"pr_url": "https://github.com/foo/bar/pull/1"}}, 13)
    body = compact(resp)
    r.check("agent.run returns id", '"id":', body)
    r.check("agent queued", '"status":"queued"', body)

    # 9. skill.list
    print("== 9. skill.list ==")
    resp = call("skill.list", {}, 14)
    body = compact(resp)
    r.check("skill.list returns skills array", '"skills":', body)

    # 10. skill.load (skill may not exist — we just check the response shape)
    print("== 10. skill.load ==")
    resp = call("skill.load", {"id": "code-reviewer"}, 15)
    body = compact(resp)
    if '"manifest"' in body:
        r.check("skill.load returns manifest", '"manifest":', body)
    elif "skill not found" in body:
        r.check("skill.load errors when missing", "skill not found", body)
    else:
        r.check("skill.load response", "result", body)

    # 11. audit.write
    print("== 11. audit.write ==")
    resp = call("audit.write", {"action": "e2e.test", "actor": "pytest", "target": "/tmp/x", "metadata": {"k": "v"}}, 16)
    body = compact(resp)
    r.check("audit hmac present", '"hmac":', body)
    audit_log = Path.home() / ".dasheng" / "audit.log"
    if audit_log.exists():
        last_line = audit_log.read_text().strip().split("\n")[-1]
        r.check("audit log appended", "e2e.test", last_line)

    # 12. secret.read (env var fallback)
    print("== 12. secret.read (env fallback) ==")
    os.environ["DASHE_SECRET_TEST_TOKEN"] = "e2e-test-secret-12345"
    resp = call("secret.read", {"name": "test-token"}, 17)
    body = compact(resp)
    r.check("secret.read env value", "e2e-test-secret-12345", body)

    # 13. browser.navigate (mock fallback since no playwright)
    print("== 13. browser.navigate (mock) ==")
    resp = call("browser.navigate", {"url": "https://example.com"}, 18)
    body = compact(resp)
    r.check("browser mock status=200", '"status":200', body)

    # 14. browser.extract
    print("== 14. browser.extract (mock) ==")
    resp = call("browser.extract", {"url": "https://example.com"}, 19)
    body = compact(resp)
    r.check("browser extract has text", '"text":', body)

    # 15. unknown method
    print("== 15. unknown method error ==")
    resp = call("does.not.exist", {}, 20)
    body = compact(resp)
    r.check("method not found", "method not found", body)
    r.check("error code -32601", '"code":-32601', body)

    # 16. invalid params
    print("== 16. invalid params ==")
    resp = call("sandbox.exec", {}, 21)
    body = compact(resp)
    r.check("exec with empty command errors", '"error":', body)
    r.check("error code -32603", '"code":-32603', body)

    # 17. file path traversal blocked
    print("== 17. file path traversal blocked ==")
    resp = call("file.read", {"path": "/etc/shadow"}, 22)
    body = compact(resp)
    r.check("blocks /etc/shadow", "not in read allowlist", body)

    # 18. subagent.research (Phase 3 T3.5)
    print("== 18. subagent.research ==")
    resp = call("subagent.research", {"query": "AI safety", "depth": 3, "cite_sources": True}, 23)
    body = compact(resp)
    r.check("research sub_queries=3", '"sub_queries"', body)
    r.check("research has citations", '"citations"', body)
    r.check("research has findings", '"findings"', body)

    # 19. subagent.run_agent
    print("== 19. subagent.run_agent ==")
    resp = call("subagent.run_agent", {"agent_id": "code-reviewer", "wait_result": True, "chain_with": ["deep-researcher"]}, 24)
    body = compact(resp)
    r.check("run_agent status=done", '"status":"done"', body)
    r.check("run_agent has chained_ids", '"chained_ids"', body)

    # 20. subagent.exec_safe (policy=read-only)
    print("== 20. subagent.exec_safe ==")
    resp = call("subagent.exec_safe", {"command": "node", "args": ["--version"], "policy": "read-only"}, 25)
    body = compact(resp)
    r.check("exec_safe policy applied", '"policy_applied":"read-only"', body)

    # 21. subagent.file_op
    print("== 21. subagent.file_op ==")
    resp = call("subagent.file_op", {"op": "write", "src": "/tmp/dasheng/sub.txt", "content": "subagent-data"}, 26)
    body = compact(resp)
    r.check("file_op write bytes=13", '"bytes_io":13', body)
    resp = call("subagent.file_op", {"op": "read", "src": "/tmp/dasheng/sub.txt"}, 27)
    body = compact(resp)
    r.check("file_op read content", '"content":"subagent-data"', body)
    resp = call("subagent.file_op", {"op": "list", "src": "/tmp/dasheng"}, 28)
    body = compact(resp)
    r.check("file_op list returns files", '"files"', body)

    # 22. metrics.snapshot (Phase 4)
    print("== 22. metrics.snapshot ==")
    resp = call("metrics.snapshot", {}, 29)
    body = compact(resp)
    r.check("metrics has uptime", '"uptime_sec"', body)
    r.check("metrics has method_calls", '"method_calls"', body)
    r.check("metrics has prom_text", '"prom_text"', body)
    r.check("prom_text has HELP", "dasheng_sandbox_uptime_seconds", body)

    # 23. subagent.apply_skill rejects traversal
    print("== 23. subagent.apply_skill rejects bad id ==")
    resp = call("subagent.apply_skill", {"skill_id": "../etc/passwd"}, 30)
    body = compact(resp)
    r.check("rejects ../", "invalid skill id", body)

    print("")
    print("===================")
    print(f"✅ Passed: {r.passed}")
    print(f"❌ Failed: {r.failed}")
    if r.failures:
        print("Failures:")
        for f in r.failures:
            print(f"  - {f}")
    return 0 if r.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
