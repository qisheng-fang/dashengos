/**
 * SkillExecutor - 技能执行器
 * 
 * 功能：
 * 1. 读取 ~/.workbuddy/skills/<name>/SKILL.md
 * 2. 解析技能指令（Markdown 格式）
 * 3. 提取可执行步骤（命令、API 调用等）
 * 4. 返回结构化指令给 Agent
 * 
 * 架构：
 * - 技能即文档（SKILL.md 是给 AI 读的指令）
 * - Agent 读取指令后，使用 Tool Registry 执行步骤
 * - 这是一种"软执行"模式，依赖 LLM 理解力
 */

import fs from 'fs';
import path from 'path';

// 技能指令步骤
export interface SkillStep {
  type: 'command' | 'api_call' | 'file_operation' | 'instruction';
  description: string;
  content: string;  // 命令、API 调用、或说明文字
  risky: boolean;  // 是否需要确认
}

// 技能执行结果
export interface SkillExecutionResult {
  success: boolean;
  skillName: string;
  steps: SkillStep[];
  summary: string;
  error?: string;
}

// 技能元数据
interface SkillMetadata {
  name: string;
  description: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * 读取技能目录下的所有技能
 */
export function listAvailableSkills(skillsDir?: string): string[] {
  const dir = skillsDir || path.join(process.env.HOME || '~', '.workbuddy/skills');
  
  if (!fs.existsSync(dir)) {
    console.warn(`[SkillExecutor] 技能目录不存在: ${dir}`);
    return [];
  }

  const skills: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = path.join(dir, entry.name);
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      if (fs.existsSync(skillMdPath)) {
        skills.push(entry.name);
      }
    }
  }

  return skills;
}

/**
 * 读取并解析 SKILL.md
 */
export function loadSkill(skillName: string, skillsDir?: string): SkillExecutionResult {
  const dir = skillsDir || path.join(process.env.HOME || '~', '.workbuddy/skills');
  const skillMdPath = path.join(dir, skillName, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    return {
      success: false,
      skillName,
      steps: [],
      summary: '',
      error: `技能 ${skillName} 不存在 (${skillMdPath})`,
    };
  }

  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const steps = parseSkillSteps(content);
    const metadata = extractMetadata(content);

    return {
      success: true,
      skillName,
      steps,
      summary: metadata.description || `执行 ${skillName} 技能`,
    };
  } catch (err: any) {
    return {
      success: false,
      skillName,
      steps: [],
      summary: '',
      error: `读取技能失败: ${err.message}`,
    };
  }
}

/**
 * 解析 SKILL.md 内容，提取可执行步骤
 * 
 * 简化版解析：
 * 1. 查找代码块（```bash ... ```）→ 提取为 command 步骤
 * 2. 查找 API 调用示例 → 提取为 api_call 步骤
 * 3. 其他内容 → instruction 步骤
 */
function parseSkillSteps(content: string): SkillStep[] {
  const steps: SkillStep[] = [];

  // 按 Markdown 标题分割
  const sections = content.split(/^#{1,3}\s+/gm);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section.trim()) continue;

    const lines = section.split('\n');
    const title = lines[0]?.trim() || '';
    const body = lines.slice(1).join('\n');

    // 提取代码块
    const codeBlockRegex = /```(\w+)\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(body)) !== null) {
      const language = match[1];
      const code = match[2].trim();

      if (language === 'bash' || language === 'sh' || language === 'shell') {
        steps.push({
          type: 'command',
          description: title || '执行命令',
          content: code,
          risky: isRiskyCommand(code),
        });
      } else if (language === 'javascript' || language === 'typescript' || language === 'python') {
        steps.push({
          type: 'command',
          description: title || '执行脚本',
          content: code,
          risky: true,  // 脚本执行默认高风险
        });
      } else {
        steps.push({
          type: 'instruction',
          description: title || '代码示例',
          content: `\`\`\`${language}\n${code}\n\`\`\``,
          risky: false,
        });
      }
    }

    // 如果没有代码块，整个 section 作为 instruction
    if (!body.match(codeBlockRegex)) {
      const cleanBody = body.trim();
      if (cleanBody) {
        steps.push({
          type: 'instruction',
          description: title || '步骤说明',
          content: cleanBody.substring(0, 500),  // 限制长度
          risky: false,
        });
      }
    }
  }

  return steps;
}

/**
 * 提取技能元数据（从 SKILL.md 头部 YAML frontmatter）
 */
function extractMetadata(content: string): SkillMetadata {
  const metadata: SkillMetadata = {
    name: '',
    description: '',
    category: 'general',
    riskLevel: 'low',
  };

  // 提取 YAML frontmatter (--- ... ---)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const lines = frontmatter.split('\n');

    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();

      if (key.trim() === 'name') metadata.name = value;
      if (key.trim() === 'description') metadata.description = value;
      if (key.trim() === 'category') metadata.category = value;
      if (key.trim() === 'risk_level') metadata.riskLevel = value as any;
    }
  }

  return metadata;
}

/**
 * 判断命令是否高风险
 */
function isRiskyCommand(command: string): boolean {
  const riskyPatterns = [
    /rm\s+-rf/i,
    /mkfs/i,
    /dd\s+/i,
    /shutdown/i,
    /reboot/i,
    /sudo/i,
    /chmod\s+777/i,
    />\s*\//,  // 重定向到根目录
  ];

  return riskyPatterns.some(pattern => pattern.test(command));
}

/**
 * 格式化技能指令（给 Agent 读）
 */
export function formatSkillInstructions(skillName: string, skillsDir?: string): string {
  const result = loadSkill(skillName, skillsDir);

  if (!result.success) {
    return `错误: ${result.error}`;
  }

  let output = `# 技能: ${skillName}\n\n`;
  output += `${result.summary}\n\n`;
  output += `## 执行步骤\n\n`;

  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i];
    output += `### 步骤 ${i + 1}: ${step.description}\n`;
    output += `- 类型: ${step.type}\n`;
    output += `- 风险: ${step.risky ? '⚠️ 高风险' : '✓ 低风险'}\n`;
    output += `- 内容:\n\`\`\`\n${step.content}\n\`\`\`\n\n`;
  }

  output += `\n## 执行建议\n`;
  output += `- 请按照步骤顺序执行\n`;
  output += `- 高风险操作需要用户确认\n`;
  output += `- 每步执行后验证结果\n`;

  return output;
}

/**
 * 执行技能（简化版：返回指令，由 Agent 执行）
 * 
 * 完整版应该：
 * 1. 解析 SKILL.md 中的所有步骤
 * 2. 自动执行低风险步骤
 * 3. 高风险步骤请求确认
 * 4. 返回执行结果
 * 
 * 但目前先用简化版（返回指令）
 */
export async function executeSkill(
  skillName: string,
  _params: Record<string, any> = {},
  options?: {
    skillsDir?: string;
    autoExecute?: boolean;
    userId?: string;
    sessionId?: string;
  }
): Promise<SkillExecutionResult> {
  console.log(`[SkillExecutor] 执行技能: ${skillName}`);

  const result = loadSkill(skillName, options?.skillsDir);

  if (!result.success) {
    return result;
  }

  // 简化版：只返回指令，不自动执行
  if (!options?.autoExecute) {
    result.summary = formatSkillInstructions(skillName, options?.skillsDir);
    return result;
  }

  // 完整版（待实现）：自动执行步骤
  // TODO: 实现自动执行逻辑
  console.warn('[SkillExecutor] 自动执行模式尚未实现，返回指令模式');

  return result;
}
