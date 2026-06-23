/**
 * ConfirmationGate - 写操作确认门
 * 
 * 功能：
 * 1. 拦截写操作（文件写入、命令执行等）
 * 2. 将待确认操作存入 pending 队列
 * 3. 提供批准/拒绝接口
 * 4. 前端轮询获取待确认操作
 * 
 * 安全策略：
 * - elevatedMode=true：跳过确认门（信任模式）
 * - elevatedMode=false：所有写操作需确认
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// PendingAction 接口
export interface PendingAction {
  id: string;
  userId: string;
  sessionId?: string;
  action: string;  // 'write_file' | 'edit_file' | 'run_command' | 'install_pkg' | ...
  params: Record<string, any>;
  description: string;  // 人类可读描述
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  resolvedAt?: string;
  result?: string;  // 执行结果（如果已批准）
}

// 确认门配置
interface GateConfig {
  enabled: boolean;
  elevatedMode: boolean;
  autoApproveLowRisk: boolean;
  pendingTTLMinutes: number;  // pending 超时时间
  storagePath: string;  // pending actions 存储路径
}

const DEFAULT_CONFIG: GateConfig = {
  enabled: true,
  elevatedMode: false,
  autoApproveLowRisk: true,
  pendingTTLMinutes: 30,
  storagePath: path.join(process.cwd(), '.workbuddy/self-heal/pending.json'),
};

let config: GateConfig = { ...DEFAULT_CONFIG };
let pendingActions: Map<string, PendingAction> = new Map();

/**
 * 初始化确认门（加载存储的 pending actions）
 */
export function initConfirmationGate(options?: Partial<GateConfig>): void {
  config = { ...DEFAULT_CONFIG, ...options };

  // 确保存储目录存在
  const dir = path.dirname(config.storagePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 加载已存储的 pending actions
  if (fs.existsSync(config.storagePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(config.storagePath, 'utf-8'));
      pendingActions = new Map(data.map((a: PendingAction) => [a.id, a]));
      console.log(`[ConfirmationGate] 加载了 ${pendingActions.size} 个 pending actions`);
    } catch (err) {
      console.error('[ConfirmationGate] 加载 pending actions 失败:', err);
    }
  }

  // 启动定时清理过期任务
  setInterval(() => cleanupExpired(), 5 * 60 * 1000);  // 每 5 分钟

  console.log(`[ConfirmationGate] 初始化完成 (elevatedMode=${config.elevatedMode})`);
}

/**
 * 请求确认（拦截写操作）
 */
export async function requestConfirmation(params: {
  userId: string;
  sessionId?: string;
  action: string;
  actionParams: Record<string, any>;
  description: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}): Promise<{ approved: boolean; pendingId?: string; message?: string }> {
  // 如果确认门未启用或处于 elevated 模式，直接批准
  if (!config.enabled || config.elevatedMode) {
    return { approved: true, message: '确认门已跳过（elevatedMode）' };
  }

  const riskLevel = params.riskLevel || assessRiskLevel(params.action, params.actionParams);

  // 低风险且启用自动批准
  if (config.autoApproveLowRisk && riskLevel === 'low') {
    return { approved: true, message: '低风险操作已自动批准' };
  }

  // 创建 pending action
  const pendingId = crypto.randomUUID();
  const pendingAction: PendingAction = {
    id: pendingId,
    userId: params.userId,
    sessionId: params.sessionId,
    action: params.action,
    params: params.actionParams,
    description: params.description,
    riskLevel,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  pendingActions.set(pendingId, pendingAction);
  persistPendingActions();

  console.log(`[ConfirmationGate] 写操作待确认: ${params.action} (risk=${riskLevel}, id=${pendingId})`);

  return { approved: false, pendingId, message: '操作已加入待确认队列' };
}

/**
 * 评估风险等级
 */
function assessRiskLevel(action: string, actionParams: Record<string, any>): 'low' | 'medium' | 'high' | 'critical' {
  // 关键系统文件
  const criticalPaths = ['/etc/', '/usr/', '/System/', 'package.json', '.env'];
  const filePath = actionParams.filePath || actionParams.path || '';

  if (criticalPaths.some(p => filePath.includes(p))) {
    return 'critical';
  }

  // 危险命令
  const dangerousCommands = ['rm -rf', 'mkfs', 'dd', 'shutdown', 'reboot'];
  const command = actionParams.command || '';
  if (dangerousCommands.some(c => command.includes(c))) {
    return 'critical';
  }

  // 文件写入/编辑
  if (action === 'write_file' || action === 'edit_file') {
    if (filePath.includes('node_modules') || filePath.includes('.git')) {
      return 'high';
    }
    return 'medium';
  }

  // 命令执行
  if (action === 'run_command') {
    if (command.includes('npm install') || command.includes('pnpm install')) {
      return 'medium';
    }
    return 'high';
  }

  // 默认
  return 'low';
}

/**
 * 批准操作
 */
export async function approveAction(pendingId: string): Promise<{ success: boolean; action?: PendingAction; message: string }> {
  const action = pendingActions.get(pendingId);

  if (!action) {
    return { success: false, message: 'Pending action 不存在' };
  }

  if (action.status !== 'pending') {
    return { success: false, message: `Action 已 ${action.status}，不能重复操作` };
  }

  action.status = 'approved';
  action.resolvedAt = new Date().toISOString();
  persistPendingActions();

  console.log(`[ConfirmationGate] 操作已批准: ${pendingId}`);

  return { success: true, action, message: '操作已批准，可以执行' };
}

/**
 * 拒绝操作
 */
export async function rejectAction(pendingId: string, reason?: string): Promise<{ success: boolean; message: string }> {
  const action = pendingActions.get(pendingId);

  if (!action) {
    return { success: false, message: 'Pending action 不存在' };
  }

  if (action.status !== 'pending') {
    return { success: false, message: `Action 已 ${action.status}，不能重复操作` };
  }

  action.status = 'rejected';
  action.resolvedAt = new Date().toISOString();
  action.result = reason || '用户拒绝';
  persistPendingActions();

  console.log(`[ConfirmationGate] 操作已拒绝: ${pendingId} (reason: ${reason || '无'})`);

  return { success: true, message: '操作已拒绝' };
}

/**
 * 获取用户的 pending actions（用于前端轮询）
 */
export function getPendingActions(userId: string, sessionId?: string): PendingAction[] {
  const results: PendingAction[] = [];

  for (const action of pendingActions.values()) {
    if (action.userId === userId && action.status === 'pending') {
      if (!sessionId || action.sessionId === sessionId) {
        results.push(action);
      }
    }
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * 获取单个 pending action
 */
export function getPendingAction(pendingId: string): PendingAction | undefined {
  return pendingActions.get(pendingId);
}

/**
 * 清理过期 pending actions
 */
function cleanupExpired(): void {
  const now = new Date();
  let cleaned = 0;

  for (const [_id, action] of pendingActions) {
    const createdAt = new Date(action.createdAt);
    const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    if (diffMinutes > config.pendingTTLMinutes) {
      action.status = 'expired';
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[ConfirmationGate] 清理了 ${cleaned} 个过期 pending actions`);
    persistPendingActions();
  }
}

/**
 * 持久化 pending actions（简化版：写入 JSON 文件）
 */
function persistPendingActions(): void {
  try {
    const data = Array.from(pendingActions.values());
    fs.writeFileSync(config.storagePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[ConfirmationGate] 持久化失败:', err);
  }
}

/**
 * 更新配置
 */
export function updateGateConfig(options: Partial<GateConfig>): void {
  config = { ...config, ...options };
  console.log(`[ConfirmationGate] 配置已更新: elevatedMode=${config.elevatedMode}`);
}

/**
 * 设置审批模式（前端 YOLO/ASK/SAFE 开关联动）
 */
export function setApprovalMode(mode: 'yolo' | 'ask' | 'safe'): void {
  switch (mode) {
    case 'yolo':
      config.elevatedMode = true
      config.autoApproveLowRisk = true
      break
    case 'ask':
      config.elevatedMode = false
      config.autoApproveLowRisk = true
      break
    case 'safe':
      config.elevatedMode = false
      config.autoApproveLowRisk = false
      break
  }
  console.log(`[ConfirmationGate] 审批模式切换: ${mode} (elevated=${config.elevatedMode}, autoLow=${config.autoApproveLowRisk})`)
}

/**
 * 获取当前配置
 */
export function getGateConfig(): GateConfig {
  return { ...config };
}

/**
 * 中间件：包装 Tool Registry 的写操作
 * 
 * 用法：
 * const wrappedExecute = confirmGate(userId, sessionId)(originalExecute);
 * const result = await wrappedExecute(toolName, params);
 */
export function confirmGate(userId: string, sessionId?: string) {
  return async (
    toolName: string,
    params: Record<string, any>,
    originalExecute: (name: string, p: Record<string, any>) => Promise<any>
  ): Promise<any> => {
    // 只读操作，直接执行
    const readOnlyTools = ['read_file', 'list_files', 'search_content', 'check_process', 'check_port', 'read_logs', 'web_fetch', 'web_search'];
    if (readOnlyTools.includes(toolName)) {
      return originalExecute(toolName, params);
    }

    // 写操作，请求确认
    const description = `${toolName}(${JSON.stringify(params).substring(0, 100)})`;
    const { approved, pendingId } = await requestConfirmation({
      userId,
      sessionId,
      action: toolName,
      actionParams: params,
      description,
    });

    if (approved) {
      return originalExecute(toolName, params);
    } else {
      // 返回 pending 状态，Agent 会告诉用户需要确认
      return {
        status: 'pending',
        pendingId,
        message: `操作已加入待确认队列，请在前端确认: ${description}`,
      };
    }
  };
}
