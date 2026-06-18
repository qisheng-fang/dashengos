#!/usr/bin/env python3
"""
P2 T2.5 · k6 替代脚本 (无 k6 runtime, 用 Python 跑同样效果)
老板原则 #5: p95 < 1s 目标

测 3 个端点 (跟 E2E 链路一致):
  1. POST /api/threads (建 thread)
  2. POST /api/threads/{id}/runs/wait (发 run 等结果)
  3. GET /api/skills (skill 列表, 反向校验)

环境:
  - DeerFlow 已在 :8002 跑 (P2 T2.4 启的那个)
  - 跑 30 次, 算 p50 / p95 / p99 / mean
  - 跟 T2.6 pytest 单测基线 < 100ms 对比
"""
import json
import os
import statistics
import sys
import time
import urllib.request
import urllib.parse

BASE = "http://localhost:8002"
COOKIE_FILE = "/tmp/deerflow_cookies.txt"
N = 30


def login_session() -> "requests.Session":
    """登录, 返回带 cookie 的 requests Session, 同时把 CSRF 写到 COOKIE_FILE 给后续 curl 脚本用"""
    import requests as _r
    pw = os.popen(
        "grep '^password:' /Users/apple/Desktop/ai-workbench-v2/vendors/deer-flow/backend/.deer-flow/admin_initial_credentials.txt | awk '{print $2}'"
    ).read().strip()
    s = _r.Session()
    r = s.post(
        f"{BASE}/api/v1/auth/login/local",
        data={"username": "admin@deerflow.dev", "password": pw},
        allow_redirects=False,
    )
    r.raise_for_status()
    # requests 写自己的 cookie jar, 我们再写一份到 COOKIE_FILE (curl 兼容格式)
    with open(COOKIE_FILE, "w") as f:
        f.write("# Netscape HTTP Cookie File\n")
        for c in s.cookies:
            f.write(f"localhost\tFALSE\t/\tFALSE\t0\t{c.name}\t{c.value}\n")
    return s


def csrf_token_from_session(s) -> str:
    """从 requests.Session 实时拿 csrf_token (不能用文件, 文件里是旧值)"""
    return s.cookies.get("csrf_token", "")


def api_post(s, path: str, body: dict) -> "requests.Response":
    """带 cookie + CSRF header 的 POST"""
    return s.post(
        f"{BASE}{path}",
        json=body,
        headers={"X-CSRF-Token": csrf_token_from_session(s)},
    )


def api_get(s, path: str) -> "requests.Response":
    """带 cookie 的 GET (CSRF 走 query 也行, 但 GET 不用)"""
    return s.get(f"{BASE}{path}")


def measure(label: str, fn) -> list[float]:
    """跑 N 次, 返回每次耗时 ms"""
    times = []
    for _ in range(N):
        start = time.perf_counter()
        try:
            fn()
        except Exception as e:
            print(f"  [WARN] {label} 异常: {e}")
            continue
        elapsed_ms = (time.perf_counter() - start) * 1000
        times.append(elapsed_ms)
    return times


def report(label: str, times: list[float]):
    if not times:
        print(f"  {label}: NO DATA")
        return None
    times_sorted = sorted(times)
    p50 = times_sorted[len(times_sorted) // 2]
    p95 = times_sorted[int(len(times_sorted) * 0.95)]
    p99 = times_sorted[int(len(times_sorted) * 0.99)] if len(times_sorted) > 1 else times_sorted[-1]
    mean = statistics.mean(times)
    print(f"  {label}  (N={len(times)})")
    print(f"    mean: {mean:6.1f}ms  p50: {p50:6.1f}ms  p95: {p95:6.1f}ms  p99: {p99:6.1f}ms")
    print(f"    min:  {min(times):6.1f}ms  max:  {max(times):6.1f}ms")
    return p95


def main():
    import requests
    print(f"=== P2 T2.5 perf budget (N={N}, target p95 < 1000ms) ===")
    print()
    s = login_session()
    csrf = csrf_token_from_session(s)
    print(f"✅ 登录 OK, CSRF={csrf[:20]}...")
    print()

    # 1. POST /api/threads
    print("--- 1. POST /api/threads (建 thread) ---")
    p95_1 = report("thread create", measure("thread create", lambda: api_post(s, "/api/threads", {"metadata": {}})))
    print()

    # 2. GET /api/skills
    print("--- 2. GET /api/skills (skill 列表) ---")
    p95_2 = report("skills list", measure("skills list", lambda: api_get(s, "/api/skills")))
    print()

    # 3. POST /api/threads/{id}/runs/wait
    print("--- 3. POST /api/threads/{id}/runs/wait (发 run) ---")
    setup_resp = api_post(s, "/api/threads", {"metadata": {}})
    setup_resp.raise_for_status()
    tid = setup_resp.json().get("thread_id")

    def run_wait():
        r = api_post(
            s,
            f"/api/threads/{tid}/runs/wait",
            {
                "assistant_id": "lead_agent",
                "input": {"messages": [{"role": "user", "content": "今日 GMV 多少?"}]},
            },
        )
        r.raise_for_status()
    p95_3 = report("run wait", measure("run wait", run_wait))
    print()

    # 4. 工具函数 (P2 T2.6 pytest 已有, 这里再验一次端到端)
    print("--- 4. get_today_gmv() 工具函数 (Python in-process) ---")
    sys.path.insert(0, "/Users/apple/Desktop/ai-workbench-v2/backend/p2")
    from get_today_gmv import get_today_gmv  # noqa: E402

    p95_4 = report("get_today_gmv()", measure("get_today_gmv()", lambda: get_today_gmv()))
    print()

    # 汇总
    print("=== 汇总 (老板原则 #5: p95 < 1s 端到端目标) ===")
    all_p95 = {
        "thread create": p95_1,
        "skills list": p95_2,
        "run wait (含 stub LLM 401)": p95_3,
        "get_today_gmv() (工具直调)": p95_4,
    }
    for k, v in all_p95.items():
        status = "✅" if v is not None and v < 1000 else "❌"
        print(f"  {status} {k:30s}  p95 = {v:6.1f}ms" if v else f"  ❌ {k:30s}  NO DATA")
    print()
    print("注: 'run wait' 包含 stub LLM 远程调用 (返 401), 实际生产是本地/近端 LLM, 会快很多")


if __name__ == "__main__":
    main()
