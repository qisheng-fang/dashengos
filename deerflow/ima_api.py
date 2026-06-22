#!/usr/bin/env python3
"""
ima_api.py — IMA OpenAPI Python 封装
支持知识库 (knowledge-base) 和笔记 (notes) 操作
老板原则 #2: 0 行业务逻辑,薄薄一层 API 桥
"""

import json
import os
import ssl
import urllib.request
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError

import certifi

BASE_URL = os.environ.get("IMA_BASE_URL", "https://ima.qq.com")
CREDENTIALS_DIR = Path(os.path.expanduser("~/.config/ima"))


def _load_credential(name: str) -> str:
    """加载凭据: 环境变量 > 文件"""
    env_key = f"IMA_{name.upper()}"
    if env_key in os.environ:
        return os.environ[env_key]
    # 也支持 IMA_OPENAPI_* 格式
    openapi_key = f"IMA_OPENAPI_{name.upper()}"
    if openapi_key in os.environ:
        return os.environ[openapi_key]

    file_path = CREDENTIALS_DIR / name
    if file_path.exists():
        return file_path.read_text().strip()

    raise RuntimeError(
        f"未找到 IMA 凭据 ({name})。"
        f"请设置 IMA_{name.upper()} 环境变量，或将凭据放在 {file_path}"
    )


def _request(api_path: str, body: dict, timeout: int = 30) -> dict:
    """发送 IMA API 请求"""
    client_id = _load_credential("client_id")
    api_key = _load_credential("api_key")

    url = f"{BASE_URL.rstrip('/')}/{api_path.lstrip('/')}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "ima-openapi-clientid": client_id,
            "ima-openapi-apikey": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    ctx = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"code": -1, "msg": f"HTTP {e.code}: {body}"}
    except URLError as e:
        return {"code": -1, "msg": f"网络错误: {e.reason}"}


# ─── Knowledge Base API ───

def search_knowledge_base(query: str = "", cursor: str = "", limit: int = 20) -> dict:
    """搜索/列出知识库"""
    return _request("openapi/wiki/v1/search_knowledge_base", {
        "query": query, "cursor": cursor, "limit": limit
    })


def get_knowledge_base(ids: list[str]) -> dict:
    """获取知识库详情 (1-20个ID)"""
    return _request("openapi/wiki/v1/get_knowledge_base", {"ids": ids})


def get_knowledge_list(
    knowledge_base_id: str,
    folder_id: str = "",
    cursor: str = "",
    limit: int = 20,
) -> dict:
    """浏览知识库内容"""
    body: dict = {
        "knowledge_base_id": knowledge_base_id,
        "cursor": cursor,
        "limit": limit,
    }
    if folder_id:
        body["folder_id"] = folder_id
    return _request("openapi/wiki/v1/get_knowledge_list", body)


def search_knowledge(
    query: str,
    knowledge_base_id: str,
    cursor: str = "",
    limit: int = 20,
) -> dict:
    """搜索知识库内容"""
    return _request("openapi/wiki/v1/search_knowledge", {
        "query": query,
        "knowledge_base_id": knowledge_base_id,
        "cursor": cursor,
        "limit": limit,
    })


def get_addable_knowledge_base_list(cursor: str = "", limit: int = 20) -> dict:
    """获取可添加的知识库列表"""
    return _request("openapi/wiki/v1/get_addable_knowledge_base_list", {
        "cursor": cursor, "limit": limit
    })


def get_media_info(media_id: str) -> dict:
    """获取媒体原文信息"""
    return _request("openapi/wiki/v1/get_media_info", {"media_id": media_id})


def check_repeated_names(
    params: list[dict],
    knowledge_base_id: str,
    folder_id: str = "",
) -> dict:
    """检查文件名是否重复"""
    body: dict = {
        "params": params,
        "knowledge_base_id": knowledge_base_id,
    }
    if folder_id:
        body["folder_id"] = folder_id
    return _request("openapi/wiki/v1/check_repeated_names", body)


def import_urls(
    urls: list[str],
    knowledge_base_id: str,
    folder_id: str = "",
) -> dict:
    """导入网页/微信文章到知识库"""
    body: dict = {
        "urls": urls,
        "knowledge_base_id": knowledge_base_id,
    }
    if folder_id:
        body["folder_id"] = folder_id
    return _request("openapi/wiki/v1/import_urls", body)


def add_knowledge(body: dict) -> dict:
    """添加内容到知识库 (文件/笔记)"""
    return _request("openapi/wiki/v1/add_knowledge", body)


# ─── Notes API ───

def list_notebook(cursor: str = "0", limit: int = 20) -> dict:
    """获取笔记本列表"""
    return _request("openapi/note/v1/list_notebook", {
        "cursor": cursor, "limit": limit
    })


def list_note(
    folder_id: str = "",
    cursor: str = "",
    limit: int = 20,
    sort_type: int = 0,
) -> dict:
    """获取笔记列表"""
    body: dict = {
        "cursor": cursor,
        "limit": limit,
        "sort_type": sort_type,
    }
    if folder_id:
        body["folder_id"] = folder_id
    return _request("openapi/note/v1/list_note", body)


def search_note(
    query: str = "",
    search_type: int = 0,
    start: int = 0,
    end: int = 20,
    sort_type: int = 0,
    folder_id: str = "",
) -> dict:
    """搜索笔记"""
    body: dict = {
        "query_info": {"title": query, "content": query} if query else {},
        "search_type": search_type,
        "start": start,
        "end": end,
        "sort_type": sort_type,
    }
    if folder_id:
        body["folder_id"] = folder_id
    return _request("openapi/note/v1/search_note", body)


def get_doc_content(note_id: str) -> dict:
    """获取笔记内容"""
    return _request("openapi/note/v1/get_doc_content", {"note_id": note_id})


def import_doc(title: str, content: str, content_format: int = 1, folder_id: str = "") -> dict:
    """创建新笔记 (content_format: 0=plain, 1=markdown, 2=json)"""
    body: dict = {
        "title": title,
        "content": content,
        "content_format": content_format,
    }
    if folder_id:
        body["folder_id"] = folder_id
    return _request("openapi/note/v1/import_doc", body)


def append_doc(note_id: str, content: str, content_format: int = 1) -> dict:
    """追加内容到笔记"""
    return _request("openapi/note/v1/append_doc", {
        "note_id": note_id,
        "content": content,
        "content_format": content_format,
    })


# ─── 便捷函数 ───

def format_kb_list(result: dict) -> str:
    """格式化知识库列表为可读文本"""
    if result.get("code") != 0:
        return f"❌ 错误: {result.get('msg', '未知错误')}"

    data = result.get("data", {})
    info_list = data.get("info_list", [])
    if not info_list:
        return "📚 没有找到知识库"

    lines = [f"📚 知识库列表 (共 {len(info_list)} 个):"]
    for i, kb in enumerate(info_list, 1):
        name = kb.get("kb_name", "未命名")
        count = kb.get("content_count", "?")
        role = kb.get("role_type", "")
        lines.append(f"  {i}. **{name}** — {count} 条内容 ({role})")
    return "\n".join(lines)


def format_kb_content(result: dict) -> str:
    """格式化知识库内容列表"""
    if result.get("code") != 0:
        return f"❌ 错误: {result.get('msg', '未知错误')}"

    data = result.get("data", {})
    items = data.get("knowledge_list", [])
    path = data.get("current_path", [])
    is_end = data.get("is_end", True)

    # 构建路径面包屑
    path_str = " > ".join(p.get("name", "") for p in path) if path else "根目录"

    lines = [f"📂 知识库「{path_str}」内容:"]
    for item in items:
        media_type = item.get("media_type", 0)
        title = item.get("title", "未命名")
        if media_type == 99:  # 文件夹
            lines.append(f"  📁 {title}/")
        else:
            lines.append(f"  📄 {title}")

    if not is_end:
        lines.append("  --- 还有更多内容 ---")
    return "\n".join(lines)


# ─── 测试入口 ───

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法: python ima_api.py <command> [args...]")
        print("命令: kb-list, kb-info <id>, kb-content <kb_id>, search-kb <query>")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "kb-list":
        result = search_knowledge_base()
        print(format_kb_list(result))

    elif cmd == "kb-info":
        kb_id = sys.argv[2] if len(sys.argv) > 2 else ""
        result = get_knowledge_base([kb_id])
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif cmd == "kb-content":
        kb_id = sys.argv[2] if len(sys.argv) > 2 else ""
        result = get_knowledge_list(kb_id)
        print(format_kb_content(result))

    elif cmd == "search-kb":
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        kb_id = sys.argv[3] if len(sys.argv) > 3 else ""
        result = search_knowledge(query, kb_id)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif cmd == "notes":
        result = search_note()
        print(json.dumps(result, ensure_ascii=False, indent=2))

    else:
        print(f"未知命令: {cmd}")
