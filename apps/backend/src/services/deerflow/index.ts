// apps/backend/src/services/deerflow/index.ts
// v0.3 spec §35-37 · DeerFlow 集成 export 入口
export { DeerFlowClient, getDeerFlowClient } from './client.js'
export { DeerFlowWorkerPool, getDeerFlowPool } from './worker-pool.js'
export {
  deerflowRegistry,
  rpcCalls,
  rpcLatency,
  poolSize,
  subAgentTasks,
  tokensUsed,
  instrumentCall,
} from './metrics.js'
