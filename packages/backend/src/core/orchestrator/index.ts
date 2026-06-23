// orchestrator/index.ts — DaShengOS v6.1 编排引擎入口
// 导出所有子代理 + 编排器 + 工具本体

export { runOrchestrator } from './graph.js'
export type { OrchestratorState, OrchestratorResult } from './graph.js'

// Sub-agents
export { RESEARCHER_SYSTEM_PROMPT, buildResearcherPrompt } from './agents/researcher.js'
export { SYNTHESIZER_SYSTEM_PROMPT, buildSynthesizerPrompt } from './agents/synthesizer.js'
export { VERIFIER_SYSTEM_PROMPT, buildVerifierPrompt } from './agents/verifier.js'
export { CODER_SYSTEM_PROMPT, buildCoderPrompt } from './agents/coder.js'
export { DESIGNER_SYSTEM_PROMPT, buildDesignerPrompt, VIDEOMAKER_SYSTEM_PROMPT, buildVideomakerPrompt } from './agents/designer.js'

// Tool ontology (dynamic)
export { buildDynamicToolOntology, analyzeTaskContract, verifyTaskProgress, verifyDeliverable } from '../harness/tool-ontology.js'
