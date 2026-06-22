// apps/web/src/store/project-context.ts
// 全局项目上下文 — 当用户切换到 Open Design / OpenMontage 等子项目时自动注册
// Chat 组件读取此上下文，自动注入项目信息到对话中

import { create } from 'zustand'

export interface ProjectContext {
  id: string           // 'open-design' | 'openmontage' | null
  name: string         // 显示名
  path: string         // 文件系统绝对路径
  entryUrl?: string    // iframe/外部入口 URL
  agendMd?: string     // AGENTS.md 内容（预加载）
  configYaml?: string  // config.yaml 内容（预加载）
}

interface ProjectContextState {
  active: ProjectContext | null
  setProject: (ctx: ProjectContext | null) => void
  /** 生成注入到 Chat 消息的项目上下文块 */
  getChatContext: () => string
}

export const useProjectContext = create<ProjectContextState>((set, get) => ({
  active: null,
  setProject: (ctx) => set({ active: ctx }),
  getChatContext: () => {
    const { active } = get()
    if (!active) return ''
    return `[项目上下文]
当前激活项目: ${active.name}
项目路径: ${active.path}
${active.agendMd ? `\nAGENTS.md:\n${active.agendMd.slice(0, 2000)}` : ''}
${active.configYaml ? `\nconfig.yaml:\n${active.configYaml.slice(0, 1000)}` : ''}
请在上述项目路径下执行文件读写和命令操作。`
  },
}))
