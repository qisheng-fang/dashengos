/**
 * DiagnosticsEngine - 系统自我诊断引擎
 * 
 * 功能：
 * 1. 错误模式识别（从日志中提取已知错误模式）
 * 2. 系统健康检查（进程、端口、磁盘、构建状态）
 * 3. 自动修复建议生成
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 错误模式定义
export interface ErrorPattern {
  id: string;
  name: string;
  description: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'typescript' | 'build' | 'runtime' | 'network' | 'filesystem' | 'database';
  autoFixable: boolean;
  fixSteps?: string[];  // 修复步骤描述（给 Agent 读）
}

// 已知错误模式库
const ERROR_PATTERNS: ErrorPattern[] = [
  // TypeScript 错误
  {
    id: 'ts2304',
    name: 'TS2304: Cannot find name',
    description: 'TypeScript 找不到名称（未导入或拼写错误）',
    pattern: /error TS2304: Cannot find name '(\w+)'/,
    severity: 'high',
    category: 'typescript',
    autoFixable: true,
    fixSteps: [
      '检查拼写错误',
      '确认是否已导入该名称',
      '如果是第三方库，检查是否已安装依赖',
    ],
  },
  {
    id: 'ts2339',
    name: 'TS2339: Property does not exist',
    description: 'TypeScript 属性不存在于类型上',
    pattern: /error TS2339: Property '(\w+)' does not exist on type '(\w+)'/,
    severity: 'high',
    category: 'typescript',
    autoFixable: true,
    fixSteps: [
      '检查属性名拼写',
      '确认类型定义是否正确',
      '如果是可选属性，使用可选链 ?.',
    ],
  },
  {
    id: 'ts2322',
    name: 'TS2322: Type not assignable',
    description: 'TypeScript 类型不匹配',
    pattern: /error TS2322: Type '(\w+)' is not assignable to type '(\w+)'/,
    severity: 'high',
    category: 'typescript',
    autoFixable: true,
    fixSteps: [
      '检查变量类型声明',
      '使用类型断言或类型守卫',
      '修改接口定义以兼容',
    ],
  },
  // 构建错误
  {
    id: 'build_module_not_found',
    name: 'Module not found',
    description: '构建时找不到模块',
    pattern: /Module not found: Error: Can't resolve '([^']+)'/,
    severity: 'high',
    category: 'build',
    autoFixable: true,
    fixSteps: [
      '检查模块路径是否正确',
      '确认模块已安装（npm install）',
      '检查 tsconfig.json paths 配置',
    ],
  },
  // 端口占用
  {
    id: 'eaddrinuse',
    name: 'EADDRINUSE: Port already in use',
    description: '端口已被占用',
    pattern: /Error: listen EADDRINUSE: address already in use :::(\d+)/,
    severity: 'medium',
    category: 'network',
    autoFixable: true,
    fixSteps: [
      '查找占用端口的进程（lsof -i :PORT）',
      '杀掉占用进程（kill -9 PID）',
      '或者更换应用端口',
    ],
  },
  // 权限错误
  {
    id: 'eacces',
    name: 'EACCES: Permission denied',
    description: '文件权限不足',
    pattern: /Error: EACCES: permission denied, (access|open|mkdir|rmdir) '([^']+)'/,
    severity: 'medium',
    category: 'filesystem',
    autoFixable: true,
    fixSteps: [
      '检查文件/目录权限（ls -la）',
      '使用 chmod 修改权限',
      '如果是全局安装，可能需要 sudo',
    ],
  },
  // 依赖缺失
  {
    id: 'cannot_find_module',
    name: 'Cannot find module',
    description: 'Node.js 运行时找不到模块',
    pattern: /Error: Cannot find module '([^']+)'/,
    severity: 'high',
    category: 'runtime',
    autoFixable: true,
    fixSteps: [
      '执行 npm install 或 pnpm install',
      '检查 package.json 是否包含该依赖',
      '删除 node_modules 重新安装',
    ],
  },
  // API 超时
  {
    id: 'api_timeout',
    name: 'API request timeout',
    description: 'API 请求超时',
    pattern: /(ETIMEDOUT|ESOCKETTIMEDOUT|timeout)/,
    severity: 'medium',
    category: 'network',
    autoFixable: false,
    fixSteps: [
      '检查网络连接',
      '增加超时时间配置',
      '检查 API 服务端状态',
    ],
  },
  // 磁盘空间
  {
    id: 'disk_full',
    name: 'No space left on device',
    description: '磁盘空间不足',
    pattern: /ENOSPC: no space left on device/,
    severity: 'critical',
    category: 'filesystem',
    autoFixable: true,
    fixSteps: [
      '清理 node_modules/.cache',
      '删除旧的构建产物',
      '使用 df -h 检查磁盘使用情况',
    ],
  },
];

// 诊断结果
export interface DiagnosticResult {
  timestamp: string;
  healthy: boolean;
  errors: Array<{
    pattern: ErrorPattern;
    matches: Array<{
      file?: string;
      line?: number;
      message: string;
      context?: string;
    }>;
  }>;
  warnings: string[];
  healthChecks: {
    processes: { ok: boolean; message: string };
    ports: { ok: boolean; message: string; checked: number[] };
    disk: { ok: boolean; message: string; freeGB?: number };
    build: { ok: boolean; message: string };
  };
  suggestions: string[];
}

/**
 * 分析日志文件，提取错误模式
 */
async function analyzeLogs(logPath: string): Promise<DiagnosticResult['errors']> {
  const errors: DiagnosticResult['errors'] = [];

  if (!fs.existsSync(logPath)) {
    return errors;
  }

  try {
    const logContent = fs.readFileSync(logPath, 'utf-8');
    const lines = logContent.split('\n');

    for (const pattern of ERROR_PATTERNS) {
      const matches: Array<{ file?: string; line?: number; message: string; context?: string }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(pattern.pattern);
        if (match) {
          // 提取上下文（前 2 行 + 后 2 行）
          const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n');
          
          matches.push({
            message: match[0],
            context: context.length > 500 ? context.substring(0, 500) + '...' : context,
          });
        }
      }

      if (matches.length > 0) {
        errors.push({
          pattern,
          matches: matches.slice(0, 10),  // 最多保留 10 个匹配
        });
      }
    }
  } catch (err) {
    console.error('[Diagnostics] 日志分析失败:', err);
  }

  return errors;
}

/**
 * 检查关键进程是否运行
 */
async function checkProcesses(): Promise<{ ok: boolean; message: string }> {
  try {
    // 检查 node 进程（简化版，实际应该用 pm2 list）
    const { stdout } = await execAsync('ps aux | grep "node.*dist/index.js" | grep -v grep || echo ""');
    
    if (stdout.trim()) {
      return { ok: true, message: '后端进程运行中' };
    } else {
      return { ok: false, message: '后端进程未运行' };
    }
  } catch (err) {
    return { ok: false, message: `进程检查失败: ${err}` };
  }
}

/**
 * 检查关键端口是否可访问
 */
async function checkPorts(ports: number[]): Promise<{ ok: boolean; message: string; checked: number[] }> {
  const failedPorts: number[] = [];

  for (const port of ports) {
    try {
      const { stdout } = await execAsync(`lsof -i :${port} | grep LISTEN || echo ""`);
      if (!stdout.trim()) {
        failedPorts.push(port);
      }
    } catch (err) {
      failedPorts.push(port);
    }
  }

  if (failedPorts.length === 0) {
    return { ok: true, message: `所有端口正常 (${ports.join(', ')})`, checked: ports };
  } else {
    return { ok: false, message: `端口未监听: ${failedPorts.join(', ')}`, checked: ports };
  }
}

/**
 * 检查磁盘空间
 */
async function checkDiskSpace(): Promise<{ ok: boolean; message: string; freeGB?: number }> {
  try {
    const { stdout } = await execAsync('df -g . | tail -1');
    const parts = stdout.trim().split(/\s+/);
    const freeGB = parseInt(parts[3], 10);  // 第四列是 Available (GB)

    if (freeGB > 5) {
      return { ok: true, message: `磁盘空间充足 (${freeGB}GB 可用)`, freeGB };
    } else if (freeGB > 1) {
      return { ok: false, message: `磁盘空间不足 (${freeGB}GB 可用)`, freeGB };
    } else {
      return { ok: false, message: `磁盘空间严重不足 (${freeGB}GB 可用)`, freeGB };
    }
  } catch (err) {
    return { ok: false, message: `磁盘检查失败: ${err}` };
  }
}

/**
 * 检查构建状态（简化版：检查 dist 目录是否存在）
 */
function checkBuildStatus(workspaceDir: string): { ok: boolean; message: string } {
  const distPath = path.join(workspaceDir, 'packages/backend/dist');

  if (fs.existsSync(distPath)) {
    const files = fs.readdirSync(distPath);
    if (files.length > 0) {
      return { ok: true, message: `构建产物存在 (${files.length} 个文件)` };
    }
  }

  return { ok: false, message: '构建产物不存在，需要重新构建' };
}

/**
 * 生成修复建议
 */
function generateSuggestions(errors: DiagnosticResult['errors'], healthChecks: DiagnosticResult['healthChecks']): string[] {
  const suggestions: string[] = [];

  // 基于错误模式生成建议
  for (const err of errors) {
    if (err.pattern.autoFixable) {
      suggestions.push(`[可自动修复] ${err.pattern.name}: ${err.pattern.fixSteps?.[0] || '查看 fixSteps'}`);
    } else {
      suggestions.push(`[需手动处理] ${err.pattern.name}: ${err.pattern.description}`);
    }
  }

  // 基于健康检查生成建议
  if (!healthChecks.processes.ok) {
    suggestions.push('[修复] 重启后端服务: cd packages/backend && pnpm build && node dist/index.js');
  }

  if (!healthChecks.ports.ok) {
    suggestions.push('[修复] 检查端口占用: lsof -i :PORT 并杀掉占用进程');
  }

  if (!healthChecks.disk.ok) {
    suggestions.push('[修复] 清理磁盘空间: rm -rf node_modules/.cache packages/*/dist');
  }

  if (!healthChecks.build.ok) {
    suggestions.push('[修复] 重新构建: pnpm build');
  }

  return suggestions;
}

/**
 * 运行完整诊断
 */
export async function runDiagnostics(options?: {
  workspaceDir?: string;
  logPath?: string;
  portsToCheck?: number[];
}): Promise<DiagnosticResult> {
  const workspaceDir = options?.workspaceDir || process.cwd();
  const logPath = options?.logPath || path.join(workspaceDir, 'logs/backend.log');
  const portsToCheck = options?.portsToCheck || [3000, 8000, 9101, 9102, 9103];

  console.log('[DiagnosticsEngine] 开始系统诊断...');

  // 并行执行所有检查
  const [errors, processes, ports, disk, build] = await Promise.all([
    analyzeLogs(logPath),
    checkProcesses(),
    checkPorts(portsToCheck),
    checkDiskSpace(),
    Promise.resolve(checkBuildStatus(workspaceDir)),
  ]);

  const healthChecks = { processes, ports, disk, build };
  const warnings: string[] = [];
  
  // 收集警告
  if (!healthChecks.processes.ok) warnings.push(healthChecks.processes.message);
  if (!healthChecks.ports.ok) warnings.push(healthChecks.ports.message);
  if (!healthChecks.disk.ok) warnings.push(healthChecks.disk.message);
  if (!healthChecks.build.ok) warnings.push(healthChecks.build.message);

  const suggestions = generateSuggestions(errors, healthChecks);

  const result: DiagnosticResult = {
    timestamp: new Date().toISOString(),
    healthy: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    healthChecks,
    suggestions,
  };

  console.log(`[DiagnosticsEngine] 诊断完成: healthy=${result.healthy}, errors=${errors.length}, warnings=${warnings.length}`);
  
  return result;
}

/**
 * 快速诊断（仅返回健康状态，不详细分析日志）
 */
export async function quickHealthCheck(workspaceDir?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await runDiagnostics({ workspaceDir });
    
    if (result.healthy) {
      return { ok: true, message: '系统健康' };
    } else {
      const criticalErrors = result.errors.filter(e => e.pattern.severity === 'critical');
      if (criticalErrors.length > 0) {
        return { ok: false, message: `严重错误: ${criticalErrors[0].pattern.name}` };
      } else {
        return { ok: false, message: `存在问题: ${result.warnings[0] || '未知'}` };
      }
    }
  } catch (err) {
    return { ok: false, message: `诊断失败: ${err}` };
  }
}
