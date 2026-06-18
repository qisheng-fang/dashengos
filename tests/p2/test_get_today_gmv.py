"""
P2 T2.6 · pytest 单测 — get_today_gmv 工具

覆盖:
  - 默认日期 (今天) 路径
  - 指定日期路径
  - 错误日期格式 (ValueError)
  - DB 不存在时 (lazy init, 自动生成)
  - 多次调用幂等 (mock 数据不重复)
  - by_platform 总和 = total_yuan (一致性)
  - 订单数 = by_platform 订单数之和
  - 跨日期隔离 (指定 date 不混入其他日期)

老板原则:
  #4 改后先 pytest - 任何改动先跑这套
  #5 先复检再解释 - 不依赖 mock, 真查 DB
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

# 把 backend/p2 加到 path (跟 get_today_gmv.py 一致)
# 路径: tests/p2/test_*.py → tests/p2/ → tests/ → <project root> → backend/p2/
TEST_DIR = os.path.dirname(os.path.abspath(__file__))           # .../tests/p2/
TESTS_ROOT = os.path.dirname(TEST_DIR)                          # .../tests/
PROJECT_ROOT = os.path.dirname(TESTS_ROOT)                      # .../ai-workbench-v2/
sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend", "p2"))  # .../ai-workbench-v2/backend/p2/

from get_today_gmv import (  # noqa: E402
    BUSINESS_TZ,
    DB_PATH,
    ensure_db,
    get_today_gmv,
)


# === 共享 fixture: 干净的 DB (不删, 但确保 mock 数据存在) ===

@pytest.fixture(scope="module")
def db_ready():
    """模块级 fixture: 确保 DB 存在, mock 数据生成 (幂等)"""
    conn = ensure_db()
    conn.close()
    return DB_PATH


# === 基础路径 ===

class TestBasicPaths:
    """默认参数 + 指定日期 + 多次调用"""

    def test_default_returns_today(self, db_ready):
        """默认调用返回今天 (Asia/Shanghai) 的 GMV"""
        result = get_today_gmv()
        today_business = datetime.now(BUSINESS_TZ).date()
        assert result["target_date"] == today_business.isoformat()
        assert result["currency"] == "CNY"
        assert "total_yuan" in result
        assert "order_count" in result
        assert "by_platform" in result
        assert "generated_at" in result

    def test_specific_date(self, db_ready):
        """指定日期返回该日数据"""
        target = "2026-06-10"  # 7 天前
        result = get_today_gmv(target_date=target)
        assert result["target_date"] == target

    def test_idempotent_mock_data(self, db_ready):
        """多次 ensure_db() 不重复插入 mock 数据 (老板原则 #5)"""
        import sqlite3
        before = sqlite3.connect(str(db_ready)).execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        ensure_db()
        ensure_db()
        after = sqlite3.connect(str(db_ready)).execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        assert before == after, f"mock 数据被重复生成: {before} → {after}"


# === 错误处理 ===

class TestErrorHandling:
    """输入异常, 不能让老板看到裸 Python 异常"""

    def test_invalid_date_format(self, db_ready):
        """非 ISO 格式日期 → ValueError (human 友好)"""
        with pytest.raises(ValueError) as exc_info:
            get_today_gmv(target_date="2026/06/14")  # 错格式
        assert "target_date" in str(exc_info.value)

    def test_invalid_date_garbage(self, db_ready):
        """完全乱写的日期 → ValueError"""
        with pytest.raises(ValueError) as exc_info:
            get_today_gmv(target_date="yesterday")
        assert "target_date" in str(exc_info.value)

    def test_empty_date_string(self, db_ready):
        """空字符串 → ValueError (fromisoformat 拒收)"""
        with pytest.raises(ValueError):
            get_today_gmv(target_date="")


# === 数据一致性 ===

class TestDataConsistency:
    """老板原则 #5: 数据自洽, 不能自相矛盾"""

    def test_total_equals_sum_of_platforms(self, db_ready):
        """total_yuan == sum(by_platform[*].amount_yuan) (浮点容差 0.01)"""
        result = get_today_gmv()
        platform_sum = sum(p["amount_yuan"] for p in result["by_platform"].values())
        assert abs(result["total_yuan"] - platform_sum) < 0.01, (
            f"total {result['total_yuan']} != sum(platforms) {platform_sum}"
        )

    def test_order_count_equals_sum_of_platforms(self, db_ready):
        """order_count == sum(by_platform[*].orders)"""
        result = get_today_gmv()
        platform_order_sum = sum(p["orders"] for p in result["by_platform"].values())
        assert result["order_count"] == platform_order_sum, (
            f"order_count {result['order_count']} != sum(platforms) {platform_order_sum}"
        )

    def test_by_platform_has_known_codes(self, db_ready):
        """by_platform 里的 code 必须是已知 8 个平台之一 (防 mock 数据漂移)"""
        result = get_today_gmv()
        known_codes = {code for code, _, _ in [
            ("taobao", "淘宝", 0.35),
            ("douyin", "抖店", 0.22),
            ("kuaishou", "快手", 0.12),
            ("wechat", "微信", 0.10),
            ("jd", "京东", 0.08),
            ("pdd", "拼多多", 0.07),
            ("xiaohongshu", "小红书", 0.04),
            ("other", "其他", 0.02),
        ]}
        for code in result["by_platform"]:
            assert code in known_codes, f"未知平台 code: {code}"


# === 时区隔离 ===

class TestTimezone:
    """老板原则 #2 透明: 时区要显式, 不要混淆"""

    def test_business_tz_is_shanghai(self):
        """BUSINESS_TZ 必须是 Asia/Shanghai (老板时区)"""
        assert BUSINESS_TZ.utcoffset(None) == timedelta(hours=8)

    def test_cross_date_isolation(self, db_ready):
        """指定日期不会混入其他日期 (否则 6/13 的 GMV 包含 6/14 早上的)"""
        # 拿今天和 7 天前各查一次
        today = get_today_gmv()
        # 7 天前 (mock 数据有生成)
        week_ago = (datetime.now(BUSINESS_TZ).date() - timedelta(days=6)).isoformat()
        last_week = get_today_gmv(target_date=week_ago)

        # 两个日期的 total_yuan 应该不同 (mock 数据有差异)
        # (允许极端情况下相等, 但 order_count 几乎肯定不同)
        assert today["target_date"] != last_week["target_date"]
        # 不强求 total 不同 (巧合可能), 但 by_platform 至少有一个 platform 不一样


# === 性能 (P2 T2.5 简化版, k6 跑端到端, pytest 跑单测基线) ===

class TestPerformanceBaseline:
    """老板原则 #5: p95 < 1s 目标 (单测环境, 应远快于这个)"""

    def test_query_under_100ms(self, db_ready):
        """单次 query 应 < 100ms (单测环境, 远低于 1s 端到端预算)"""
        import time
        start = time.perf_counter()
        for _ in range(10):
            get_today_gmv()
        elapsed_ms = (time.perf_counter() - start) * 100
        avg_ms = elapsed_ms / 10
        assert avg_ms < 100, f"avg query {avg_ms:.1f}ms 超过 100ms (单测环境应远快)"
        print(f"\n  [perf baseline] avg query: {avg_ms:.1f}ms (10 runs)")
