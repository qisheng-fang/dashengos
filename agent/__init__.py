# Day 0+ · Dasheng 大师 OS · Agent Brain (Python)
#
# 架构 (老板 2026-06-15 拍板的 B 方案):
#   Frontend :3000 (Next.js + CopilotKit, 不动)
#     │
#     │ AG-UI 协议 (CopilotKit 标准, 不变)
#     │
#   Agent :8001 (本目录, Python + FastAPI)
#     │
#     │ AgentBrain ABC (隔离层)
#     │
#   HermesBrain (本目录 hermes_brain.py) ─── 唯一 import hermes_agent 的地方
#     │
#   hermes-agent v0.13.0 (vendor 在 ~/.hermes/hermes-agent, 锁 commit 1af2e18d4)
#
# 关键约束 (B 阶段留后门, 未来 A 阶段可卸 hermes):
#   1. 只有 hermes_brain.py 可以 import hermes_agent.* (其他文件禁止)
#   2. 数据写到 ~/.dasheng/ (不写到 ~/.hermes/), schema 自己定
#   3. 工具名 / agent_id / session_id 走我们的 enum, 映射表在 hermes_brain.py
#   4. hermes-agent 版本锁死在 pyproject.toml, 升级需老板批准
#
# 文件:
#   brain.py             AgentBrain ABC + 公共类型 (Pydantic models)
#   hermes_brain.py      唯一 import hermes_agent 的实现
#   dasheng_brain.py     (未来 A 阶段) 自己写 AIAgent 的实现, 同一 ABC
#   brain_factory.py     根据 BRAIN_BACKEND env 选实现
#   config.py            配置加载 (env vars + ~/.dasheng/config.toml)
#   main.py              FastAPI 入口, AG-UI 协议服务端
#   tools/               (未来) 工具注册表
#   api/                 (未来) auth + audit + rate limit
#
# 启动:
#   cd ai-workbench-v2
#   uv venv agent/.venv --python 3.11
#   source agent/.venv/bin/activate
#   uv pip install -e /Users/apple/.hermes/hermes-agent
#   uv pip install -r agent/requirements.txt
#   python -m agent.main

__version__ = "0.1.0-b1"
