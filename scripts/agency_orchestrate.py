#!/usr/bin/env python3
"""
agency_orchestrate.py — LangGraph + Agency Agents 编排引擎
接收任务 → 路由 Agent → 构建执行图 → 运行 → 聚合结果
"""
import json, os, sys, time
from agency_loader import load_agents
from agency_router import match_agents, detect_category, task_to_concepts

# Try importing langgraph
try:
    from langgraph.graph import StateGraph, END
    from langgraph.checkpoint.memory import MemorySaver
    HAS_LANGGRAPH = True
except ImportError:
    HAS_LANGGRAPH = False

# Try OpenAI-compatible client for LLM calls
try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

DEEPSEEK_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
DEEPSEEK_BASE = os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')


class AgencyOrchestrator:
    """编排器：将 217 Agent 接入 LangGraph 图执行"""
    
    def __init__(self, task: str, max_agents: int = 5, mode: str = 'sequential'):
        self.task = task
        self.mode = mode  # sequential, parallel, debate
        self.matched = match_agents(task, max_agents)
        self.category = detect_category(task)
        self.concepts = task_to_concepts(task)
        self.results = {}
        self.client = None
        
        if HAS_OPENAI:
            self.client = OpenAI(api_key=DEEPSEEK_KEY, base_url=DEEPSEEK_BASE)
    
    def build_graph(self):
        """构建 LangGraph 执行图"""
        if not HAS_LANGGRAPH:
            return None
        
        workflow = StateGraph(dict)
        
        # 添加节点：每个匹配的 Agent 一个节点
        for i, agent in enumerate(self.matched):
            node_name = f"agent_{i}_{agent['division']}"
            workflow.add_node(node_name, self._make_agent_node(agent))
        
        # 添加汇总节点
        workflow.add_node("synthesize", self._synthesize_node)
        
        # 设置入口
        if self.matched:
            workflow.set_entry_point(f"agent_0_{self.matched[0]['division']}")
        
        # 连接节点
        if self.mode == 'sequential':
            for i in range(len(self.matched) - 1):
                n1 = f"agent_{i}_{self.matched[i]['division']}"
                n2 = f"agent_{i+1}_{self.matched[i+1]['division']}"
                workflow.add_edge(n1, n2)
            if self.matched:
                last = f"agent_{len(self.matched)-1}_{self.matched[-1]['division']}"
                workflow.add_edge(last, "synthesize")
                workflow.add_edge("synthesize", END)
        
        elif self.mode == 'parallel':
            # All agents → synthesize → END
            for i, agent in enumerate(self.matched):
                workflow.add_edge(f"agent_{i}_{agent['division']}", "synthesize")
            workflow.add_edge("synthesize", END)
        
        elif self.mode == 'debate':
            # Agents debate in pairs, then synthesize
            for i in range(0, len(self.matched) - 1, 2):
                n1 = f"agent_{i}_{self.matched[i]['division']}"
                n2 = f"agent_{i+1}_{self.matched[i+1]['division']}"
                workflow.add_edge(n1, n2)
            if self.matched:
                last = f"agent_{len(self.matched)-1}_{self.matched[-1]['division']}"
                workflow.add_edge(last, "synthesize")
                workflow.add_edge("synthesize", END)
        
        return workflow.compile(checkpointer=MemorySaver())
    
    def _make_agent_node(self, agent: dict):
        """创建 Agent 执行节点"""
        agent_prompt = agent.get('full_prompt', agent.get('description', ''))
        agent_name = agent['name']
        agent_mission = agent.get('mission', '')
        agent_rules = agent.get('rules', '')
        
        def agent_node(state: dict):
            if not self.client:
                return {**state, agent['id']: f"[{agent_name}] 分析结论：需要 LLM 连接（检查 DEEPSEEK_API_KEY）"}
            
            # 构建提示词
            previous = state.get('_previous_output', '')
            debate_context = state.get('_debate_context', '')
            
            prompt_preview = agent_prompt[:3000]
            prefix_prev = '## 前序 Agent 输出\n'
            prefix_debate = '## 辩论上下文\n'
            system_prompt = f"""你是一个专业 AI Agent：{agent_name}
            
## 你的身份
{prompt_preview}

## 核心任务
{agent_mission[:500]}

## 关键规则
{agent_rules[:500]}

## 当前编排任务
用户任务：{self.task}

{prefix_prev + previous if previous else ''}
{prefix_debate + debate_context if debate_context else ''}

请基于你的专业角度，给出分析、建议或执行方案。用中文回复，简洁专业，200-500字。
"""
            try:
                resp = self.client.chat.completions.create(
                    model="deepseek-chat",
                    messages=[{"role": "system", "content": system_prompt}],
                    max_tokens=1000,
                    temperature=0.7,
                )
                output = resp.choices[0].message.content
                return {**state, agent['id']: output, '_previous_output': output}
            except Exception as e:
                return {**state, agent['id']: f"[{agent_name}] 执行异常: {str(e)}"}
        
        return agent_node
    
    def _synthesize_node(self, state: dict):
        """汇总所有 Agent 输出"""
        outputs = []
        for agent in self.matched:
            out = state.get(agent['id'], '')
            if out:
                outputs.append(f"### {agent['emoji']} {agent['name']} ({agent['division']})\n{out}")
        
        combined = "\n\n".join(outputs)
        
        if self.client and len(outputs) > 1:
            try:
                resp = self.client.chat.completions.create(
                    model="deepseek-chat",
                    messages=[{
                        "role": "system",
                        "content": f"你是总编 Agent。请整合以下 {len(outputs)} 个专业 Agent 的分析，生成一份综合报告。\n\n用户任务：{self.task}\n\n各 Agent 分析：\n{combined}\n\n请生成结构化综合报告：1. 执行摘要 2. 核心发现 3. 建议方案 4. 下一步行动"
                    }],
                    max_tokens=1500,
                    temperature=0.5,
                )
                synthesis = resp.choices[0].message.content
                return {**state, '_synthesis': synthesis, '_individual_outputs': combined}
            except:
                pass
        
        return {**state, '_synthesis': combined, '_individual_outputs': combined}
    
    def run(self):
        """运行编排"""
        if not HAS_LANGGRAPH:
            return self._run_simple()
        
        try:
            graph = self.build_graph()
            if not graph:
                return self._run_simple()
            
            result = graph.invoke(
                {"task": self.task, "_previous_output": ""},
                {"configurable": {"thread_id": f"agency_{int(time.time())}"}}
            )
            return {
                'success': True,
                'mode': self.mode,
                'agents_used': len(self.matched),
                'individual_outputs': {a['id']: result.get(a['id'], '') for a in self.matched},
                'synthesis': result.get('_synthesis', ''),
            }
        except Exception as e:
            return {'success': False, 'error': str(e), 'fallback': self._run_simple()}
    
    def _run_simple(self):
        """简化执行模式（无需 LangGraph）"""
        if not self.client:
            return {'success': False, 'error': 'LLM 客户端不可用，请检查 DEEPSEEK_API_KEY'}
        
        outputs = {}
        previous = ''
        
        for agent in self.matched:
            system_prompt = f"""你是专业 Agent：{agent['name']}（{agent['division']}）
{agent.get('description','')[:500]}

用户任务：{self.task}
{'前序分析：' + previous if previous else ''}
请给出专业分析（200-500字中文）"""
            
            try:
                resp = self.client.chat.completions.create(
                    model="deepseek-chat",
                    messages=[{"role": "system", "content": system_prompt}],
                    max_tokens=800,
                    temperature=0.7,
                )
                output = resp.choices[0].message.content
                outputs[agent['id']] = output
                previous = output
            except Exception as e:
                outputs[agent['id']] = f"Error: {e}"
        
        # Synthesize
        combined = "\n\n".join(f"### {a['emoji']} {a['name']}: {outputs.get(a['id'],'')}" for a in self.matched)
        
        try:
            resp = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "system", "content": f"整合以下分析生成综合报告（任务：{self.task}）：\n\n{combined}"}],
                max_tokens=1200,
                temperature=0.5,
            )
            synthesis = resp.choices[0].message.content
        except:
            synthesis = combined
        
        return {
            'success': True,
            'mode': 'simple',
            'agents_used': len(self.matched),
            'matched_agents': [{'name': a['name'], 'division': a['division'], 'emoji': a['emoji']} for a in self.matched],
            'individual_outputs': outputs,
            'synthesis': synthesis,
        }


if __name__ == '__main__':
    task = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else '分析中国AI市场趋势并给出建议'
    mode = os.environ.get('AGENCY_MODE', 'sequential')
    
    orch = AgencyOrchestrator(task, max_agents=4, mode=mode)
    result = orch.run()
    
    if result.get('success'):
        print(f"\n{'='*60}")
        print(f"任务: {task}")
        print(f"模式: {result['mode']} | Agent数: {result['agents_used']}")
        print(f"{'='*60}")
        if 'matched_agents' in result:
            for a in result['matched_agents']:
                print(f"  {a['emoji']} {a['name']} ({a['division']})")
        print(f"\n{'='*60}")
        print("综合报告:")
        print(f"{'='*60}")
        print(result.get('synthesis', '')[:2000])
    else:
        print(f"执行失败: {result.get('error')}")
