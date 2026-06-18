// packages/backend/src/core/workflow-templates.ts · 生产级工作流模板 v2
// ----------------------------------------------------------------------
// 去掉所有 AI 生成的占位符，每个模板对应爱尤趣实际业务场景
// 执行时调用 ComfyUI / 社媒 API / Shopify / 数据管道 等真实工具
// ----------------------------------------------------------------------

import type { OrchestrationStep } from './orchestrator.js'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  icon: string
  category: string
  estimated_tokens: number
  steps: OrchestrationStep[]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ================================================================
  //  1. 商品图批量生成 — Studio + ComfyUI 联动
  //  场景：新品上架前需要多角度产品图、场景图、详情页配图
  //  执行链：选模型 → SDXL/SD3 生图 → 自动裁切缩放 → 质检 → 入库
  // ================================================================
  {
    id: 'product_images',
    name: '商品图批量生成',
    description:
      '选择 ComfyUI 工作流 + 配置模型 → 自动生成商品主图/场景图/细节图 → 裁切质检 → 输出到素材库。适用于新品上架、季节换款、A/B 测试素材。',
    icon: 'image',
    category: 'production',
    estimated_tokens: 4000,
    steps: [
      {
        id: 'step-1-config',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '根据用户描述提取产品关键词（品类/风格/色调/角度），生成 ComfyUI 工作流所需的 prompt 和负面提示词',
      },
      {
        id: 'step-2-generate',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '将上一步生成的 prompt 提交到 ComfyUI 工作流执行图片生成（调用 /api/v1/comfy/execute），记录输出图片路径和参数',
      },
      {
        id: 'step-3-qc',
        agent_id: 'quality',
        mode: 'pipeline',
        input_transform:
          '检查生成的图片是否符合要求（分辨率/构图合规性/品牌一致性），列出不合格的及原因',
      },
      {
        id: 'step-4-catalog',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '将合格的图片整理为素材清单（文件名/尺寸/用途标签），输出可导入 Shopify 的 CSV 格式',
      },
    ],
  },

  // ================================================================
  //  2. 社媒内容日历 — 三平台一键排期
  //  场景：每周内容规划，一次输入→自动拆解为 3 平台适配格式
  //  执行链：主题策划 → 抖音脚本/小红书笔记/公众号文章 → 排期表
  // ================================================================
  {
    id: 'social_calendar',
    name: '社媒内容日历',
    description:
      '输入本周/本月主题 → 自动拆解为抖音短视频脚本、小红书种草笔记、微信公众号文章三种格式 → 生成 7~30 天排期表。对接社媒发布 API。',
    icon: 'calendar',
    category: 'content',
    estimated_tokens: 6000,
    steps: [
      {
        id: 'step-1-plan',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '根据用户输入的主题/目标，规划本周或本月的社媒内容策略（目标平台/发布频率/核心话题/转化目标）',
      },
      {
        id: 'step-2-adapt',
        agent_id: 'writer',
        mode: 'parallel',
        children: [
          {
            id: 'step-2a-douyin',
            agent_id: 'social_douyin',
            mode: 'pipeline',
            input_transform:
              '将内容策略适配为抖音短视频脚本（15~60秒）：黄金3秒钩子→主体内容→CTA→话题标签。包含画面描述和BGM建议。',
          },
          {
            id: 'step-2b-xhs',
            agent_id: 'social_xiaohongshu',
            mode: 'pipeline',
            input_transform:
              '将内容策略适配为小红书种草笔记：标题（含emoji）→正文分段（痛点/体验/推荐）→标签矩阵。字数300~800字。',
          },
          {
            id: 'step-2c-wechat',
            agent_id: 'social_wechat',
            mode: 'pipeline',
            input_transform:
              '将内容策略适配为微信公众号文章：标题（2个备选）→导语→正文（含小标题分层）→结尾CTA→摘要。1500~3000字。',
          },
        ],
      },
      {
        id: 'step-3-schedule',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '整合三平台内容为排期表格：日期/平台/标题/状态(草稿/已排期/已发布)。支持导出为 iCal 或 JSON 格式供定时发布系统使用。',
      },
    ],
  },

  // ================================================================
  //  3. 竞品监控追踪 — 价格/活动/内容变动告警
  //  场景：每日自动扫描竞品在各大平台的价格、促销、新内容
  //  执行链：抓取 → 结构化提取 → 对比基线 → 异常标记 → 告警
  // ================================================================
  {
    id: 'competitor_monitor',
    name: '竞品监控追踪',
    description:
      '配置监控目标（竞品店铺/账号/关键词）→ 定时抓取价格/活动/内容变化 → 与历史基线对比 → 标记异常（降价/上新/大促）→ 推送告警报告。',
    icon: 'radar',
    category: 'intelligence',
    estimated_tokens: 5000,
    steps: [
      {
        id: 'step-1-scrape',
        agent_id: 'researcher',
        mode: 'parallel',
        children: [
          {
            id: 'step-1a-price',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '抓取竞品在各电商平台（淘宝/京东/拼多多）的当前价格、促销标签、库存状态',
          },
          {
            id: 'step-1b-content',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '抓取竞品在社媒平台（抖音/小红书）的最新内容、互动数据、粉丝增长',
          },
        ],
      },
      {
        id: 'step-2-compare',
        agent_id: 'analyst',
        mode: 'pipeline',
        input_transform:
          '将本次抓取数据与历史基线对比，计算价格变动幅度、内容发布频率变化、互动率趋势。标记异常项（降幅>10%/新活动/爆款内容）',
      },
      {
        id: 'step-3-alert',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成竞品监控报告：异常事件列表（按紧急度排序）→ 各维度趋势总结 → 建议应对措施。输出 Markdown 格式',
      },
    ],
  },

  // ================================================================
  //  4. 客服话术库更新 — FAQ→标准回复模板
  //  场景：新品上线/促销活动后需更新客服知识库
  //  执行链：收集问题 → 分类归档 → 生成标准回复 → 审核 → 上线
  // ================================================================
  {
    id: 'faq_update',
    name: '客服话术库更新',
    description:
      '输入新品信息或常见问题 → 自动生成客服标准回复模板 → 按类别（物流/售后/产品/支付）归类 → 质检语气和准确性 → 输出可导入客服系统的 JSON 格式。',
    icon: 'message-square',
    category: 'operation',
    estimated_tokens: 3000,
    steps: [
      {
        id: 'step-1-collect',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '根据用户提供的新品信息或原始 FAQ 列表，扩展出完整的客户可能提问（至少覆盖：发货/退换货/材质/尺寸/使用方法/清洗保养/兼容性）',
      },
      {
        id: 'step-2-draft',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '为每个问题撰写标准客服回复：简洁专业 + 温暖友好 + 包含具体解决方案。每条回复控制在 50~150 字。',
      },
      {
        id: 'step-3-review',
        agent_id: 'quality',
        mode: 'pipeline',
        input_transform:
          '审核所有回复的：1)事实准确性 2)语气一致性 3)是否遗漏重要信息 4)是否符合品牌规范。标出需修改的条目及原因',
      },
      {
        id: 'step-4-export',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '将审核通过的话术整理为结构化数据：category / question / answer / tags / priority。输出 JSON + 可读 Markdown 双格式',
      },
    ],
  },

  // ================================================================
  //  5. 跨境独立站部署 — S2B2C 多区域上线
  //  场景：Shopify 独立站开通/迁移/多区域扩展
    //  执行链：环境配置 → 域名DNS → 支付网关 → 物流方案 → 产品上架
  // ================================================================
  {
    id: 'shopify_deploy',
    name: '跨境独立站部署',
    description:
      '选择目标区域（东南亚/北美/欧洲）→ 自动配置 Shopify 店铺（货币/语言/税则）→ 设置支付网关和物流方案 → 批量导入产品和页面 → 部署检查清单。',
    icon: 'globe',
    category: 'deployment',
    estimated_tokens: 8000,
    steps: [
      {
        id: 'step-1-env',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '根据目标区域（东南亚/北美/欧洲等）生成 Shopify 配置方案：基础货币/支持语言/税费规则/隐私政策要求/GDPR 合规事项',
      },
      {
        id: 'step-2-payment',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '制定该区域的支付网关方案（PayPal/Stripe/本地钱包/货到付款），包含手续费对比和推荐优先级',
      },
      {
        id: 'step-3-shipping',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '设计物流方案：国内直发/海外仓/第三方物流(3PL)的对比，包含时效/成本/追踪能力的分析',
      },
      {
        id: 'step-4-checklist',
        agent_id: 'quality',
        mode: 'pipeline',
        input_transform:
          '生成完整部署检查清单（20~30 项）：DNS/SSL/支付测试/订单测试/邮件通知/移动端适配/速度优化/SEO 基础设置。每项标注优先级(P0/P1/P2)',
      },
    ],
  },

  // ================================================================
  //  6. 数据日报自动汇总 — 销售/流量/转化
  //  场景：每天早晨自动拉取各渠道数据生成运营日报
  //  执行链：多源采集 → 清洗标准化 → 关键指标计算 → 可视化描述 → 推送
  // ================================================================
  {
    id: 'daily_report',
    name: '数据日报自动汇总',
    description:
      '自动从 Shopify / 社媒后台 / 广告平台 拉取昨日数据 → 计算关键指标（GMV/转化率/ROI/获客成本） → 同比/环比分析 → 生成带图表描述的可读日报 → 推送到钉钉/飞书/邮箱。',
    icon: 'bar-chart-3',
    category: 'analytics',
    estimated_tokens: 5000,
    steps: [
      {
        id: 'step-1-collect',
        agent_id: 'researcher',
        mode: 'parallel',
        children: [
          {
            id: 'step-1a-sales',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '拉取 Shopify 昨日销售数据：订单数/GMV/客单价/退款率/热销TOP10',
          },
          {
            id: 'step-1b-traffic',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '拉取各渠道流量数据：UV/PV/跳出率/平均停留时长/来源分布',
          },
          {
            id: 'step-1c-ad',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '拉取广告投放数据：花费/展示/点击/CPC/ROAS',
          },
        ],
      },
      {
        id: 'step-2-analyze',
        agent_id: 'analyst',
        mode: 'pipeline',
        input_transform:
          '计算关键指标并做同比/环比分析：转化率变化趋势/ROI 是否健康/哪些渠道效率下降/异常数据标注。用数据说话，不写空话。',
      },
      {
        id: 'step-3-report',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成运营日报：①核心指标卡片（GMV/订单/转化率/ROI 及环比箭头）②渠道表现排名 ③异动解读（涨跌原因）④今日行动建议（3条以内，具体可执行）。格式：Markdown + 图表占位描述',
      },
    ],
  },
]

export function getTemplates(): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES
}

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id)
}
