# deerflow/ · DeerFlow 2.0 Python daemon (v0.3 spec §35-37)
#
# Phase 0 PoC: hello world + health.ping via JSON-RPC over Unix socket
# Phase 3 完整版: 14 IPC 方法 + 5 sub-agents + worker 池 + audit bridge
#
# 模块:
#   daemon.py           14 JSON-RPC 方法 (spec §35.4)
#   agents/             1 lead + 5 sub-agents (spec §36)
#   hermes_adapter.py  AG-UI ↔ JSON-RPC 协议桥 (spec §35.6)
#   audit_bridge.py     LangFuse → DaShengOS audit (spec §37.3)
#   credentials.py      Keychain 凭据 (spec §35.6)
#   mcp_bridge.py       DeerFlow 作 MCP client (spec §35.5)
#
# 老板原则 #2: 0 行业务逻辑,薄薄一层
