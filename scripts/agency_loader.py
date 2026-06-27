#!/usr/bin/env python3
"""
agency_loader.py — 解析 agency-agents 中所有 Agent 定义
输出结构化 JSON，供 LangGraph 图节点使用
"""
import json, os, re, yaml

AGENCY_ROOT = os.path.join(os.path.dirname(__file__), '..', 'embedded', 'agency-agents')
NON_DIVISION_DIRS = {'strategy', 'integrations', 'examples', 'scripts', '.git', '.github'}

def parse_frontmatter(text: str) -> dict:
    """解析 YAML frontmatter --- ... ---"""
    m = re.match(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
    if not m:
        return {}
    try:
        return yaml.safe_load(m.group(1)) or {}
    except:
        return {}

def extract_sections(text: str) -> dict:
    """提取 Markdown 中的关键段落"""
    sections = {}
    current = None
    for line in text.split('\n'):
        if line.startswith('## '):
            current = line[3:].strip()
            sections[current] = []
        elif current and line.startswith('### '):
            sub = line[4:].strip()
            current = f"{current} > {sub}"
            sections[current] = []
        elif current:
            sections[current].append(line)
    return {k: '\n'.join(v).strip() for k, v in sections.items() if v}

def load_agents():
    agents = []
    divisions = {}

    # Load divisions.json
    div_path = os.path.join(AGENCY_ROOT, 'divisions.json')
    if os.path.exists(div_path):
        with open(div_path) as f:
            divisions = json.load(f).get('divisions', {})

    for entry in sorted(os.listdir(AGENCY_ROOT)):
        div_path_full = os.path.join(AGENCY_ROOT, entry)
        if not os.path.isdir(div_path_full) or entry in NON_DIVISION_DIRS:
            continue
        if entry.startswith('.'):
            continue

        div_info = divisions.get(entry, {})
        
        for fname in sorted(os.listdir(div_path_full)):
            if not fname.endswith('.md'):
                continue
            fpath = os.path.join(div_path_full, fname)
            with open(fpath) as f:
                content = f.read()

            fm = parse_frontmatter(content)
            sections = extract_sections(content)

            # Extract core mission keywords for routing
            mission = sections.get('🎯 Core Mission', sections.get('🎯 Your Core Mission', ''))
            rules = sections.get('🚨 Critical Rules', sections.get('🚨 Critical Rules You Must Follow', ''))
            identity = sections.get('🧠 Identity & Memory', sections.get('🧠 Your Identity & Memory', ''))

            # Build keyword index from description + mission + identity
            text_for_index = f"{fm.get('description','')} {mission} {identity} {fm.get('vibe','')}"
            keywords = extract_keywords(text_for_index)

            agents.append({
                'id': fname.replace('.md', ''),
                'name': fm.get('name', fname),
                'description': fm.get('description', ''),
                'division': entry,
                'division_label': div_info.get('label', entry),
                'division_color': div_info.get('color', '#6B7280'),
                'emoji': fm.get('emoji', ''),
                'vibe': fm.get('vibe', ''),
                'keywords': keywords,
                'mission': mission[:500] if mission else '',
                'rules': rules[:500] if rules else '',
                'identity': identity[:300] if identity else '',
                'full_prompt': content[:8000],  # Truncate for token budget
                'path': fpath,
            })

    return agents

def extract_keywords(text: str) -> list:
    """从文本中提取关键词"""
    # English keywords
    en_words = set(re.findall(r'\b[A-Za-z]{4,}\b', text.lower()))
    # Filter common stopwords
    stopwords = {'this', 'that', 'with', 'from', 'they', 'have', 'been', 'were', 'when', 'will', 'what', 'which', 'their', 'about', 'would', 'could', 'should', 'there', 'where', 'those', 'these', 'other', 'every', 'after', 'before', 'during', 'through', 'without', 'within', 'between', 'because'}
    en_keywords = list(en_words - stopwords)[:20]
    
    # Chinese keywords
    cn_words = set(re.findall(r'[\u4e00-\u9fff]{2,}', text))
    cn_keywords = list(cn_words)[:10]
    
    return en_keywords + cn_keywords


if __name__ == '__main__':
    agents = load_agents()
    print(json.dumps({
        'total': len(agents),
        'agents': agents,
        'divisions': list(set(a['division'] for a in agents)),
    }, ensure_ascii=False, indent=2))
