#!/usr/bin/env python3
"""
agency_router.py — 任务→Agent 智能路由器 v2
支持中英文任务，基于概念映射 + 描述匹配 + 部门权重
"""
import json, os, sys, re
from collections import Counter
from agency_loader import load_agents

# 中文概念 → 英文关键词映射
CN_CONCEPT_MAP = {
    # 报告/分析
    '报告': ['report', 'analysis', 'research', 'insight'],
    '分析': ['analysis', 'analytics', 'research', 'evaluate'],
    '行业': ['industry', 'market', 'sector'],
    '市场': ['market', 'marketing', 'commerce'],
    '调研': ['research', 'survey', 'investigation'],
    '数据': ['data', 'analytics', 'metrics'],
    '趋势': ['trend', 'forecast', 'prediction'],
    '竞品': ['competitor', 'competitive', 'benchmark'],
    '策略': ['strategy', 'strategist', 'planning'],
    
    # 营销
    '营销': ['marketing', 'promotion', 'campaign'],
    '推广': ['promotion', 'growth', 'distribution'],
    '品牌': ['brand', 'identity', 'positioning'],
    '广告': ['advertising', 'ads', 'paid'],
    '内容': ['content', 'creator', 'writing'],
    '社交': ['social', 'community', 'engagement'],
    '短视频': ['video', 'short', 'tiktok', 'douyin'],
    '直播': ['livestream', 'live', 'streaming'],
    '电商': ['ecommerce', 'commerce', 'shop'],
    '小红书': ['xiaohongshu', 'social', 'content'],
    '抖音': ['douyin', 'tiktok', 'short-video'],
    '微信': ['wechat', 'social', 'official-account'],
    
    # 技术
    '代码': ['code', 'developer', 'engineer', 'programming'],
    '开发': ['developer', 'engineer', 'build', 'implementation'],
    '架构': ['architecture', 'architect', 'design'],
    '测试': ['testing', 'test', 'qa', 'quality'],
    '部署': ['deploy', 'devops', 'infrastructure'],
    '安全': ['security', 'audit', 'compliance', 'threat'],
    '前端': ['frontend', 'ui', 'react'],
    '后端': ['backend', 'api', 'server'],
    
    # 设计
    '设计': ['design', 'designer', 'visual'],
    'UI': ['ui', 'interface', 'design'],
    'UX': ['ux', 'user', 'experience', 'research'],
    '视觉': ['visual', 'design', 'graphic'],
    
    # 商业
    '商业': ['business', 'strategy', 'commercial'],
    '销售': ['sales', 'selling', 'revenue'],
    '客户': ['customer', 'client', 'support'],
    '产品': ['product', 'feature', 'roadmap'],
    '增长': ['growth', 'scale', 'optimization'],
    '财务': ['finance', 'financial', 'budget'],
    
    # 中国特定
    '中国': ['china', 'chinese', 'localization'],
    '中文': ['chinese', 'localization', 'mandarin'],
    '跨境': ['cross-border', 'international', 'global'],
}

def task_to_concepts(task: str) -> set:
    """提取中文任务的概念对应英文关键词"""
    concepts = set()
    task_lower = task.lower()
    
    # 中文概念映射
    for cn_word, en_words in CN_CONCEPT_MAP.items():
        if cn_word.lower() in task:
            concepts.update(en_words)
    
    # 英文单词直接提取
    en_words = re.findall(r'\b[a-z]{4,}\b', task_lower)
    concepts.update(en_words)
    
    return concepts

def detect_category(task: str) -> str:
    t = task.lower()
    if any(k in t for k in ['报告', 'report', '分析报告', '行业分析']):
        return 'report'
    if any(k in t for k in ['营销', 'marketing', '推广', '广告', '投放', '社交媒体']):
        return 'marketing'
    if any(k in t for k in ['代码', 'code', '编程', '开发', 'bug', '修复']):
        return 'code'
    if any(k in t for k in ['安全', 'security', '漏洞', '审计', '渗透']):
        return 'security'
    if any(k in t for k in ['设计', 'design', 'ui', 'ux', '界面']):
        return 'design'
    if any(k in t for k in ['分析', 'analysis', '数据', '调研', 'research']):
        return 'analysis'
    if any(k in t for k in ['内容', 'content', '文案', '写作', '文章']):
        return 'content'
    if any(k in t for k in ['商业', 'business', '策略', '战略', '商业模式']):
        return 'business'
    if any(k in t for k in ['社交', 'social', '抖音', '小红书', '微博', '微信', 'tiktok']):
        return 'social'
    return 'general'

TASK_CATEGORIES = {
    'report': ['marketing', 'strategy', 'academic'],
    'marketing': ['marketing', 'paid-media', 'design', 'sales'],
    'code': ['engineering', 'testing', 'security'],
    'security': ['security', 'engineering'],
    'design': ['design', 'product'],
    'analysis': ['strategy', 'finance', 'academic', 'marketing'],
    'content': ['marketing', 'design'],
    'development': ['engineering', 'testing', 'project-management'],
    'business': ['strategy', 'sales', 'finance', 'product'],
    'social': ['marketing', 'paid-media', 'design'],
}

DIVISION_WEIGHTS = {
    'marketing': 1.3, 'strategy': 1.2, 'engineering': 1.0,
    'design': 1.0, 'product': 0.9, 'sales': 0.9,
    'finance': 0.8, 'security': 0.8, 'project-management': 0.8,
    'academic': 0.7, 'testing': 0.7, 'paid-media': 0.9,
    'support': 0.6, 'game-development': 0.5, 'gis': 0.5,
    'spatial-computing': 0.5,
}

def match_agents(task: str, max_agents: int = 5) -> list:
    agents = load_agents()
    concepts = task_to_concepts(task)
    category = detect_category(task)
    preferred_divs = set(TASK_CATEGORIES.get(category, []))
    
    scores = []
    for agent in agents:
        score = 0
        div = agent.get('division', '')
        desc = agent.get('description', '').lower()
        name = agent.get('name', '').lower()
        mission = agent.get('mission', '').lower()
        keywords = [k.lower() for k in agent.get('keywords', [])]
        
        # 概念命中（描述/名称/关键词）
        for c in concepts:
            if c in desc:
                score += 4
            if c in name:
                score += 5
            if c in mission:
                score += 3
            if c in keywords:
                score += 2
            if c in div:
                score += 1
        
        # 部门权重
        div_weight = DIVISION_WEIGHTS.get(div, 0.5)
        if div in preferred_divs:
            div_weight *= 1.8
        
        score *= div_weight
        
        # 保底分：即使没概念命中，preferred division 也至少给 1 分
        if score == 0 and div in preferred_divs:
            score = 2
        
        if score > 0:
            scores.append((score, agent))
    
    scores.sort(key=lambda x: -x[0])
    return [a for _, a in scores[:max_agents]]


if __name__ == '__main__':
    task = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else 'Generate a marketing report for the Chinese market'
    matched = match_agents(task, 7)
    print(json.dumps({
        'task': task,
        'category': detect_category(task),
        'concepts': list(task_to_concepts(task))[:15],
        'matched': [{
            'name': a['name'],
            'division': a['division'],
            'emoji': a['emoji'],
            'description': a['description'][:120],
        } for a in matched],
    }, ensure_ascii=False, indent=2))
