"""
P2 T2.3 · 查今日 GMV · Mock 数据生成 + 工具函数
==============================================

业务: 查今日 (老板时区) GMV, 按平台聚合 + 总计
数据源: SQLite (vendors/deer-flow/data/today_gmv.db)
工具: get_today_gmv() -> dict {total, by_platform, today, generated_at}

老板原则:
  #5 先复检再解释 — 单测先跑, 再集成
  #6 禁止复读机 — 按平台聚合, 不要输出"今日"两字
  #7 单次工具失败立刻换工具 — try/except 完整, 异常返回 human 友好

P2 限制 (透明 — 老板原则 #2):
  - Mock 数据, 不接真订单/支付网关
  - 工具函数本身不是 DeerFlow skill (skill 是 markdown), 工具通过 MCP/builtin 注册
  - LLM 实际调这个工具需要真 API key
"""
from __future__ import annotations

import os
import random
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# === 路径常量 (相对 ai-workbench-v2 根) ===
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "today_gmv.db"

# === Mock 数据常量 ===
# 跟 DaShengOS EcommerceAgent.query_gmv 平台列表对齐 (DaShengOS Pillar 1 真实集成)
PLATFORMS = [
    ("taobao", "淘宝", 0.35),       # 35% 权重
    ("douyin", "抖店", 0.22),       # 22%
    ("kuaishou", "快手", 0.12),     # 12%
    ("wechat", "微信", 0.10),       # 10%
    ("jd", "京东", 0.08),           # 8%
    ("pdd", "拼多多", 0.07),        # 7%
    ("xiaohongshu", "小红书", 0.04),  # 4%
    ("other", "其他", 0.02),        # 2%
]

# 单订单金额范围 (分, 避免浮点): ¥10 - ¥5,000
ORDER_AMOUNT_MIN = 1000   # ¥10
ORDER_AMOUNT_MAX = 500000  # ¥5,000
ORDER_COUNT_PER_DAY = 200  # 模拟 200 单/天

# === 时区: 老板默认 Asia/Shanghai (UTC+8) ===
BUSINESS_TZ = timezone(timedelta(hours=8))


def _init_schema(conn: sqlite3.Connection) -> None:
    """初始化 orders 表 (单表, 简化)"""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            order_date TEXT NOT NULL,         -- ISO 8601 date (YYYY-MM-DD)
            order_time TEXT NOT NULL,         -- ISO 8601 datetime
            status TEXT NOT NULL DEFAULT 'paid'  -- paid / refunded / pending
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_orders_date_status
        ON orders (order_date, status)
    """)
    conn.commit()


def _generate_mock_data(conn: sqlite3.Connection, days_back: int = 7) -> None:
    """
    生成 mock 数据 — 今天 + 前 N 天
    仅当表为空时生成 (幂等)
    """
    cur = conn.execute("SELECT COUNT(*) FROM orders")
    if cur.fetchone()[0] > 0:
        return  # 已生成过, 跳过

    today = datetime.now(BUSINESS_TZ).date()
    platforms_with_weights = [(code, name, w) for code, name, w in PLATFORMS]

    rows = []
    for day_offset in range(days_back):
        target_date = today - timedelta(days=day_offset)
        # 每天订单数略有波动
        n_orders = max(1, ORDER_COUNT_PER_DAY + random.randint(-30, 30))
        for _ in range(n_orders):
            platform_code, _, _ = random.choices(
                platforms_with_weights,
                weights=[w for _, _, w in platforms_with_weights],
            )[0]
            # 金额也按平台略偏: 淘宝/京东偏大, 拼多多/小红书偏小
            base = ORDER_AMOUNT_MIN
            cap = ORDER_AMOUNT_MAX
            if platform_code in ("taobao", "jd"):
                cap = ORDER_AMOUNT_MAX * 2
            elif platform_code in ("pdd", "xiaohongshu"):
                base = ORDER_AMOUNT_MIN // 2
            amount = random.randint(base, cap)
            # 95% paid, 4% refunded, 1% pending
            status = random.choices(
                ["paid", "refunded", "pending"],
                weights=[0.95, 0.04, 0.01],
            )[0]
            # 当天的随机时间 (0-23h)
            h = random.randint(0, 23)
            m = random.randint(0, 59)
            s = random.randint(0, 59)
            order_time = datetime(
                target_date.year, target_date.month, target_date.day,
                h, m, s, tzinfo=BUSINESS_TZ,
            ).isoformat()
            rows.append((platform_code, amount, target_date.isoformat(), order_time, status))

    conn.executemany(
        "INSERT INTO orders (platform, amount_cents, order_date, order_time, status) "
        "VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    print(f"[P2 T2.3] mock data generated: {len(rows)} orders across {days_back} days, "
          f"DB at {DB_PATH}")


def ensure_db() -> sqlite3.Connection:
    """确保 DB 存在, schema 在, mock 数据生成 (幂等)"""
    conn = sqlite3.connect(str(DB_PATH))
    _init_schema(conn)
    _generate_mock_data(conn)
    return conn


# === 工具函数: get_today_gmv ===
# 这就是 DeerFlow 的 agent 在 P2 真正要调的工具
# 签名固定, LangGraph/LangChain 自动识别为 Tool

def get_today_gmv(target_date: str | None = None) -> dict[str, Any]:
    """
    P2 工具: 查询指定日期的 GMV (默认今天, 老板时区 Asia/Shanghai)

    Args:
        target_date: ISO 8601 date (YYYY-MM-DD), 默认今天

    Returns:
        {
            "target_date": "2026-06-14",
            "currency": "CNY",
            "total_yuan": 12345.67,
            "order_count": 200,
            "by_platform": {
                "taobao": {"amount_yuan": 4321.00, "orders": 70},
                "douyin": {"amount_yuan": 2715.00, "orders": 44},
                ...
            },
            "generated_at": "2026-06-14T03:24:00+08:00"
        }

    Raises:
        ValueError: target_date 格式错
        RuntimeError: DB 读失败
    """
    if target_date is None:
        target_date_obj = datetime.now(BUSINESS_TZ).date()
    else:
        try:
            target_date_obj = date.fromisoformat(target_date)
        except ValueError as e:
            raise ValueError(f"target_date 格式错 (期望 YYYY-MM-DD): {target_date}") from e

    target_date_str = target_date_obj.isoformat()

    conn = ensure_db()
    try:
        # 单次查询: 按平台聚合 paid 订单的 (sum_cents, count)
        cur = conn.execute(
            "SELECT platform, SUM(amount_cents) AS total, COUNT(*) AS cnt "
            "FROM orders "
            "WHERE order_date = ? AND status = 'paid' "
            "GROUP BY platform",
            (target_date_str,),
        )
        by_platform_raw: dict[str, tuple[int, int]] = {}  # code -> (cents, count)
        order_count = 0
        for platform, total_cents, cnt in cur:
            by_platform_raw[platform] = (total_cents or 0, cnt)
            order_count += cnt
    except sqlite3.DatabaseError as e:
        raise RuntimeError(f"DB query failed: {e}") from e
    finally:
        conn.close()

    # 转 yuan (1 yuan = 100 cents), 浮点保留 2 位
    by_platform: dict[str, dict[str, Any]] = {}
    for code, (total_cents, cnt) in by_platform_raw.items():
        # 找平台中文名
        name = next((n for c, n, _ in PLATFORMS if c == code), code)
        by_platform[code] = {
            "name": name,
            "amount_yuan": round(total_cents / 100, 2),
            "orders": cnt,
        }

    total_cents = sum(c for c, _ in by_platform_raw.values())
    return {
        "target_date": target_date_str,
        "currency": "CNY",
        "total_yuan": round(total_cents / 100, 2),
        "order_count": order_count,
        "by_platform": by_platform,
        "generated_at": datetime.now(BUSINESS_TZ).isoformat(),
    }


if __name__ == "__main__":
    # Smoke: 直接跑一下
    print("=== P2 T2.3 mock data + tool smoke test ===")
    result = get_today_gmv()
    print(json_dumps := __import__("json").dumps(result, ensure_ascii=False, indent=2))
