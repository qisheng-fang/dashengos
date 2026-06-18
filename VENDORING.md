# VENDORING 策略 — hermes-agent (B 阶段)
# 老板 2026-06-15 拍板, 见 memory `ai-workbench-v2-3-service-architecture.md`
#
# ## 决策
# **B 阶段不 copy 源码进 vendor/, 用 `pip install -e <本地路径>` 装**
#
# ## 为什么
# - hermes-agent 1.9GB (含 node_modules / __pycache__ / .git / 二进制)
# - copy 一次 5+ 分钟, 每次升级又 5+ 分钟
# - `pip install -e <path>` 同样锁版本, 效果一样, 速度 100x
#
# ## 怎么锁版本
# 当前锁定:
#   - PyPI metadata version: 0.13.0
#   - git commit: 1af2e18d4
#   - 位置: /Users/apple/.hermes/hermes-agent
#   - 见 agent/hermes_brain.py 顶部 HERMES_AGENT_VERSION / HERMES_AGENT_COMMIT
#
# 升级流程 (老板批准才能动):
#   1. cd /Users/apple/.hermes/hermes-agent
#   2. git fetch && git checkout <新 commit>
#   3. 改 agent/hermes_brain.py 顶部两个常量
#   4. 跑 `bash scripts/smoke.sh` 验证
#   5. 改 CHANGELOG, 老板 review
#
# ## A 阶段怎么办
# A 阶段写完 dasheng_brain.py 后, vendor 策略切换:
#   1. 改 agent/brain_factory.py 默认 backend = "dasheng"
#   2. 保留 hermes_brain.py 但用 # 注释掉
#   3. 验证 DASHENG_BRAIN_BACKEND=hermes 还能切回去 (灰度)
#   4. 2 周稳定后, 删 hermes_brain.py + 卸 hermes-agent 依赖
#   5. 改 install 文档, 不用 uv pip install -e hermes 了
#
# ## 长期
# A 阶段稳定 + 切流 100% 后, 选择性 copy 核心 hermes 工具 (browser / file / vision)
# 进 vendor/ (Python 源码, 不要 node_modules), 用 SPDX 注释保留 MIT 版权。
# 这是后话, A 阶段交付前不动。
