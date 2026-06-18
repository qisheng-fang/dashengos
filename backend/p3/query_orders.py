"""
P3 T3.2 · 订单查询工具 (订单级别, 多维过滤)
============================================

业务: 查订单 (订单级明细, 不是 GMV 聚合), 跟 P2 get_today_gmv 互补
数据源: SQLite (跟 P2 共享同一个 orders.db, 加 order_id 主键 + customer_name)
工具: query_orders(date_from, date_to, platform, status, limit) -> dict

老板原则:
  #2 薄协议层: 0 业务逻辑, 纯数据查询
  #5 不写死: 时间范围/平台/状态全部参数化
  #6 禁止复读机: 返回结构化 JSON, 不输出"查询成功"等废话
  #7 单次工具失败立刻换: try/except 完整, 异常返回 human 友好

P3 限制 (透明):
  - Mock 数据 (跟 P2 一致), 不接真订单系统
  - SQLite 单表, 不分库不分表
  - 跟 get_today_gmv 共享 orders.db schema, 加 order_id + customer_name 字段
"""
from __future__ import annotations

import os
import random
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# === 路径常量 (跟 P2 一致, 共享同一个 orders.db) ===
# P2 路径: backend/p2/data/today_gmv.db
# P3 路径: backend/p3/data/orders.db (新建, 跟 P2 schema 兼容)
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "orders.db"

# === Mock 数据常量 (跟 P2 对齐) ===
PLATFORMS = [
    ("taobao", "淘宝", 0.35),
    ("douyin", "抖店", 0.22),
    ("kuaishou", "快手", 0.12),
    ("wechat", "微信", 0.10),
    ("jd", "京东", 0.08),
    ("pdd", "拼多多", 0.07),
    ("xiaohongshu", "小红书", 0.04),
    ("other", "其他", 0.02),
]
ORDER_STATUSES = ["paid", "refunded", "pending"]
ORDER_STATUS_NAMES = {"paid": "已支付", "refunded": "已退款", "pending": "待支付"}
CUSTOMER_NAMES = [
    "张三", "李四", "王五", "赵六", "钱七", "孙八", "周九", "吴十",
    "郑十一", "王十二", "冯十三", "陈十四", "褚十五", "卫十六", "蒋十七", "沈十八",
]

ORDER_AMOUNT_MIN = 1000   # ¥10
ORDER_AMOUNT_MAX = 500000  # ¥5,000
ORDER_COUNT_PER_DAY = 200  # 模拟 200 单/天 (跟 P2 一致)

# === 时区: 老板默认 Asia/Shanghai ===
BUSINESS_TZ = timezone(timedelta(hours=8))


def _init_schema(conn: sqlite3.Connection) -> None:
    """P3 扩展 schema: 加 order_id 主键 + customer_name (P2 已经有 platform/amount_cents/order_date/order_time/status)"""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,          -- ORD-YYYYMMDD-NNNN 格式
            platform TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            order_date TEXT NOT NULL,
            order_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'paid',
            customer_name TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_orders_date_status
        ON orders (order_date, status)
    """)
    conn.commit()


def _generate_mock_data(conn: sqlite3.Connection, days_back: int = 7) -> None:
    """生成 mock 订单数据 (幂等, 仅当表为空)"""
    cur = conn.execute("SELECT COUNT(*) FROM orders")
    if cur.fetchone()[0] > 0:
        return

    today = datetime.now(BUSINESS_TZ).date()
    rows = []
    seq_by_day: dict[str, int] = {}

    for day_offset in range(days_back):
        target_date = today - timedelta(days=day_offset)
        date_str = target_date.strftime("%Y%m%d")
        seq_by_day[date_str] = 0

        n_orders = max(1, ORDER_COUNT_PER_DAY + random.randint(-30, 30))
        for _ in range(n_orders):
            seq_by_day[date_str] += 1
            platform_code, _, _ = random.choices(
                [(c, n, w) for c, n, w in PLATFORMS],
                weights=[w for _, _, w in PLATFORMS],
            )[0]
            # 金额也按平台略偏
            base, cap = ORDER_AMOUNT_MIN, ORDER_AMOUNT_MAX
            if platform_code in ("taobao", "jd"):
                cap = ORDER_AMOUNT_MAX * 2
            elif platform_code in ("pdd", "xiaohongshu"):
                base = ORDER_AMOUNT_MIN // 2
            amount = random.randint(base, cap)
            status = random.choices(ORDER_STATUSES, weights=[0.95, 0.04, 0.01])[0]
            customer = random.choice(CUSTOMER_NAMES)

            h, m, s = random.randint(0, 23), random.randint(0, 59), random.randint(0, 59)
            order_time = datetime(
                target_date.year, target_date.month, target_date.day,
                h, m, s, tzinfo=BUSINESS_TZ,
            ).isoformat()

            order_id = f"ORD-{date_str}-{seq_by_day[date_str]:04d}"
            rows.append((order_id, platform_code, amount, target_date.isoformat(),
                        order_time, status, customer))

    conn.executemany(
        "INSERT INTO orders (order_id, platform, amount_cents, order_date, order_time, status, customer_name) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    print(f"[P3 T3.2] mock data generated: {len(rows)} orders across {days_back} days, "
          f"DB at {DB_PATH}")


def ensure_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    _init_schema(conn)
    _generate_mock_data(conn)
    return conn


def query_orders(
    date_from: str | None = None,
    date_to: str | None = None,
    platform: str | None = None,
    status: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """
    P3 工具: 查询订单, 多维过滤 (订单级明细, 不是 GMV 聚合)

    Args:
        date_from: YYYY-MM-DD, 默认今天
        date_to: YYYY-MM-DD, 默认今天
        platform: 平台 code (taobao/douyin/...), 默认 None (全平台)
        status: paid/refunded/pending, 默认 None (全状态)
        limit: 返回最多多少条, 默认 20

    Returns:
        {
            "orders": [
                {
                    "order_id": "ORD-20260614-0042",
                    "platform": "douyin",
                    "platform_name": "抖店",
                    "amount_yuan": 1234.56,
                    "status": "paid",
                    "status_name": "已支付",
                    "customer_name": "张三",
                    "order_time": "2026-06-14T15:23:11+08:00"
                },
                ...
            ],
            "total_count": int,  # 过滤后实际返回数
            "total_amount_yuan": float,
            "filters": {date_from, date_to, platform, status, limit}
        }

    Raises:
        ValueError: 日期格式错
        RuntimeError: DB 读失败
    """
    # 日期校验
    today = datetime.now(BUSINESS_TZ).date()
    try:
        date_from_obj = date.fromisoformat(date_from) if date_from else today
        date_to_obj = date.fromisoformat(date_to) if date_to else today
    except ValueError as e:
        raise ValueError(f"date_from/date_to 格式错 (期望 YYYY-MM-DD): {e}") from e

    if date_from_obj > date_to_obj:
        raise ValueError(f"date_from ({date_from}) > date_to ({date_to})")

    if limit <= 0 or limit > 500:
        raise ValueError(f"limit 必须在 1-500, 实际 {limit}")

    conn = ensure_db()
    try:
        sql = (
            "SELECT order_id, platform, amount_cents, order_time, status, customer_name "
            "FROM orders "
            "WHERE order_date >= ? AND order_date <= ?"
        )
        params: list[Any] = [date_from_obj.isoformat(), date_to_obj.isoformat()]

        if platform:
            sql += " AND platform = ?"
            params.append(platform)
        if status:
            sql += " AND status = ?"
            params.append(status)

        sql += " ORDER BY order_time DESC LIMIT ?"
        params.append(int(limit))

        cur = conn.execute(sql, params)
        rows = cur.fetchall()
    except sqlite3.DatabaseError as e:
        raise RuntimeError(f"DB query failed: {e}") from e
    finally:
        conn.close()

    platform_name_map = {c: n for c, n, _ in PLATFORMS}
    orders = []
    total_amount = 0.0
    for r in rows:
        order_id, platform_code, amount_cents, order_time, st, customer = r
        amount_yuan = round(amount_cents / 100, 2)
        total_amount += amount_yuan
        orders.append({
            "order_id": order_id,
            "platform": platform_code,
            "platform_name": platform_name_map.get(platform_code, platform_code),
            "amount_yuan": amount_yuan,
            "status": st,
            "status_name": ORDER_STATUS_NAMES.get(st, st),
            "customer_name": customer,
            "order_time": order_time,
        })

    return {
        "orders": orders,
        "total_count": len(orders),
        "total_amount_yuan": round(total_amount, 2),
        "filters": {
            "date_from": date_from_obj.isoformat(),
            "date_to": date_to_obj.isoformat(),
            "platform": platform,
            "status": status,
            "limit": limit,
        },
    }


if __name__ == "__main__":
    import json
    print("=== P3 T3.2 订单查询 smoke test ===")

    # 默认 (今天 + 全部)
    print("\n--- 默认 (今天) ---")
    result = query_orders()
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 平台过滤
    print("\n--- 抖店 5 单 ---")
    result = query_orders(platform="douyin", limit=5)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 日期范围
    print("\n--- 前 3 天 paid ---")
    three_days_ago = (datetime.now(BUSINESS_TZ).date() - timedelta(days=2)).isoformat()
    today_str = datetime.now(BUSINESS_TZ).date().isoformat()
    result = query_orders(date_from=three_days_ago, date_to=today_str, status="paid", limit=10)
    print(json.dumps(result, ensure_ascii=False, indent=2))
