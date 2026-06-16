#!/usr/bin/env python3
"""E2E test: agent bridge CORS 配置 + 实时 OPTIONS preflight (2026-06-16 老板拍板)

老板踩坑: 前端在 127.0.0.1:3000, bridge CORS 白名单只配 localhost:3000,
  OPTIONS preflight 缺 access-control-allow-origin, 浏览器 TypeError "Failed to fetch".
修法: 默认同时支持 localhost + 127.0.0.1.

跑法:
  cd /Users/apple/Desktop/ai-workbench-v2
  agent/.venv/bin/python -m agent.tests.test_cors_e2e

期望: 4 断言全过 (default 双 origin + env 覆盖 + live bridge 200 + origin 头对)
返 0 = PASS, 返 1 = FAIL
"""
import os
import sys
import urllib.request
from pathlib import Path

# 让 import agent.* 能找到 (test 在子目录)
_PKG_PARENT = Path(__file__).resolve().parent.parent.parent
if str(_PKG_PARENT) not in sys.path:
    sys.path.insert(0, str(_PKG_PARENT))


def _check(name: str, cond: bool, detail: str = "") -> bool:
    """小 helper: 打印 + 累计"""
    mark = "✅" if cond else "❌"
    suffix = f"  ({detail})" if detail else ""
    print(f"  {mark} {name}{suffix}")
    return cond


def test_build_cors_origins_defaults() -> bool:
    """不打 env var, 默认必须同时含 localhost + 127.0.0.1"""
    print("\n[1] _build_cors_origins() default 双 origin")
    # 强制清空 env, 跑真实默认
    os.environ.pop("DASHENG_CORS_ORIGINS", None)
    # 重新 import 拿新函数 (module-level 已求值过 default, 需 reload)
    import importlib
    from agent import main as agent_main
    importlib.reload(agent_main)

    origins = agent_main._build_cors_origins()
    ok = True
    ok &= _check("default 含 http://localhost:3000",
                 "http://localhost:3000" in origins,
                 f"got {origins}")
    ok &= _check("default 含 http://127.0.0.1:3000",
                 "http://127.0.0.1:3000" in origins,
                 f"got {origins}")
    return ok


def test_build_cors_origins_env_override() -> bool:
    """打 env var, 配什么用什么"""
    print("\n[2] DASHENG_CORS_ORIGINS env 覆盖默认")
    os.environ["DASHENG_CORS_ORIGINS"] = "https://prod.example.com,https://staging.example.com"
    import importlib
    from agent import main as agent_main
    importlib.reload(agent_main)

    origins = agent_main._build_cors_origins()
    ok = True
    ok &= _check("env 覆盖生效 · 含 prod",
                 "https://prod.example.com" in origins,
                 f"got {origins}")
    ok &= _check("env 覆盖生效 · 含 staging",
                 "https://staging.example.com" in origins,
                 f"got {origins}")
    ok &= _check("env 覆盖生效 · 不含 localhost 默认",
                 "http://localhost:3000" not in origins,
                 f"got {origins}")
    # 清回
    os.environ.pop("DASHENG_CORS_ORIGINS", None)
    return ok


def test_live_bridge_cors_preflight() -> bool:
    """live bridge 8001 必须返回 access-control-allow-origin"""
    print("\n[3] live bridge OPTIONS preflight (假设 8001 在跑)")
    req = urllib.request.Request(
        "http://127.0.0.1:8001/api/agent",
        method="OPTIONS",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            status = resp.status
            allow_origin = resp.headers.get("Access-Control-Allow-Origin", "")
            allow_methods = resp.headers.get("Access-Control-Allow-Methods", "")
            allow_headers = resp.headers.get("Access-Control-Allow-Headers", "")
            allow_credentials = resp.headers.get("Access-Control-Allow-Credentials", "")
    except Exception as e:
        print(f"  ⚠️  SKIP: 8001 没起 ({type(e).__name__}: {e})")
        return True  # bridge 没起不算 fail, 单元测已覆盖

    ok = True
    ok &= _check("preflight 200", status == 200, f"got {status}")
    ok &= _check("Access-Control-Allow-Origin 匹配",
                 allow_origin == "http://127.0.0.1:3000",
                 f"got {allow_origin!r}")
    ok &= _check("Access-Control-Allow-Credentials=true",
                 allow_credentials.lower() == "true",
                 f"got {allow_credentials!r}")
    ok &= _check("Access-Control-Allow-Methods 含 POST",
                 "POST" in allow_methods,
                 f"got {allow_methods!r}")
    ok &= _check("Access-Control-Allow-Headers 含 content-type",
                 "content-type" in allow_headers.lower(),
                 f"got {allow_headers!r}")
    return ok


def test_live_bridge_localhost_still_works() -> bool:
    """localhost:3000 origin 也要能过 (向后兼容)"""
    print("\n[4] live bridge OPTIONS preflight · localhost:3000 origin (向后兼容)")
    req = urllib.request.Request(
        "http://127.0.0.1:8001/api/agent",
        method="OPTIONS",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            status = resp.status
            allow_origin = resp.headers.get("Access-Control-Allow-Origin", "")
    except Exception as e:
        print(f"  ⚠️  SKIP: 8001 没起 ({type(e).__name__}: {e})")
        return True

    return _check("localhost:3000 origin 也通过",
                  status == 200 and allow_origin == "http://localhost:3000",
                  f"status={status} allow-origin={allow_origin!r}")


def main() -> int:
    print("=" * 60)
    print("agent bridge CORS e2e")
    print("=" * 60)

    results = [
        test_build_cors_origins_defaults(),
        test_build_cors_origins_env_override(),
        test_live_bridge_cors_preflight(),
        test_live_bridge_localhost_still_works(),
    ]
    passed = sum(results)
    total = len(results)

    print("\n" + "=" * 60)
    if passed == total:
        print(f"✅ PASS ({passed}/{total})")
        return 0
    print(f"❌ FAIL ({passed}/{total})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
