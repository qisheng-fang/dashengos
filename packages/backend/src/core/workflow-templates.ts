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
  // ================================================================
  //  7. 短视频批量剪辑 — AI 自动剪辑+字幕+封面
  //  场景：批量处理产品展示/口播/教程类短视频
  //  执行链：素材分析 → 自动剪辑 → 字幕生成 → 封面设计 → 导出
  // ================================================================
  {
    id: 'video_batch_edit',
    name: '短视频批量剪辑',
    description:
      '上传原始素材 → AI 自动识别高光片段 → 智能剪辑 + 自动字幕 + 封面生成 → 多平台格式导出。适合产品展示、口播、教程类短视频批量生产。',
    icon: 'image',
    category: 'production',
    estimated_tokens: 6000,
    steps: [
      {
        id: 'step-1-analyze',
        agent_id: 'researcher',
        mode: 'pipeline',
        input_transform:
          '分析上传的原始视频素材：识别场景切换点、人脸位置、语音片段、画面质量评分。输出时间轴标注和可剪辑片段建议。',
      },
      {
        id: 'step-2-edit',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '根据上一步分析结果，生成剪辑脚本（时间轴/转场/特效/滤镜/BGM），调用视频处理工具执行自动剪辑。输出最终视频文件路径。',
      },
      {
        id: 'step-3-subtitle',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '对剪辑后的视频进行语音识别 → 生成 SRT 字幕文件 → 叠加字幕到视频（支持中英文双语）。检查字幕时间轴对齐和错别字。',
      },
      {
        id: 'step-4-cover',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '从视频中提取最佳帧作为封面候选 → 添加标题文字和品牌元素 → 生成 3 个封面方案（抖音1:1/小红书3:4/YouTube 16:9）。',
      },
    ],
  },

  // ================================================================
  //  8. 季节性营销策划 — 节日/大促全案生成
  //  场景：618/双11/圣诞/春节等节点的完整营销方案
  //  执行链：市场分析 → 策略制定 → 内容生产 → 执行排期
  // ================================================================
  {
    id: 'seasonal_campaign',
    name: '季节性营销策划',
    description:
      '输入节日/大促节点 → 自动生成完整营销策划案：市场分析、人群洞察、内容矩阵、投放策略、ROI预估、执行甘特图。覆盖618/双11/黑五/圣诞/春节等。',
    icon: 'calendar',
    category: 'content',
    estimated_tokens: 8000,
    steps: [
      {
        id: 'step-1-market',
        agent_id: 'researcher',
        mode: 'pipeline',
        input_transform:
          '分析目标节点的市场趋势：往年数据回顾/竞品动作预判/消费者行为预测/热点话题挖掘。输出结构化市场分析报告。',
      },
      {
        id: 'step-2-strategy',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '制定营销策略：核心主题/目标人群分层/内容矩阵（图文+短视频+直播）/投放预算分配/促销机制设计。输出 3 页策略 PPT 大纲。',
      },
      {
        id: 'step-3-content',
        agent_id: 'writer',
        mode: 'parallel',
        children: [
          {
            id: 'step-3a-social',
            agent_id: 'social_douyin',
            mode: 'pipeline',
            input_transform: '生成抖音+小红书预热内容脚本（倒计时/剧透/福利预告），含话题标签矩阵和发布时间建议。',
          },
          {
            id: 'step-3b-live',
            agent_id: 'writer',
            mode: 'pipeline',
            input_transform: '生成直播策划脚本：开场/产品讲解/限时秒杀/互动抽奖/收尾CTA。包含主播话术和场控checklist。',
          },
        ],
      },
      {
        id: 'step-4-schedule',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '整合所有内容为执行甘特图：预热期/爆发期/返场期的时间线 → 各渠道内容排期 → 责任人分配 → 预算消耗预估。输出 Excel 可导入格式。',
      },
    ],
  },

  // ================================================================
  //  9. 用户评论情感分析 — NPS/舆情监控
  //  场景：定期分析商品评论和社媒提及的情感倾向
  //  执行链：多源采集 → 情感分类 → 话题聚类 → 行动建议
  // ================================================================
  {
    id: 'sentiment_analysis',
    name: '用户评论情感分析',
    description:
      '采集商品评论 + 社媒提及 + 客服对话 → NLP 情感分类（正面/中性/负面）→ 话题聚类 → 产品改进建议。产出 NPS 趋势图和风险预警。',
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
            id: 'step-1a-reviews',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '采集各平台最新商品评论（好评/中评/差评各取TOP50），记录评分、文字内容、图片、时间。',
          },
          {
            id: 'step-1b-social',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '采集社媒平台品牌提及（微博/小红书/抖音），筛选互动量>100的内容进行深度分析。',
          },
        ],
      },
      {
        id: 'step-2-analyze',
        agent_id: 'analyst',
        mode: 'pipeline',
        input_transform:
          '情感分析：正面/中性/负面分类 + 话题聚类（质量/物流/客服/价格/包装）→ 计算 NPS 净推荐值 → 识别高频关键词和情绪峰值时间。',
      },
      {
        id: 'step-3-report',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成情感分析报告：①NPS 趋势图描述 ②TOP5 好评/差评摘录 ③话题热度排行 ④风险预警（差评突增/竞品对比）⑤改进建议 TOP3。',
      },
    ],
  },

  // ================================================================
  // 10. 产品详情页生成 — A+页面自动化
  //  场景：新品上架需要完整详情页（图文+视频+A+）
  //  执行链：竞品分析 → 文案生成 → 图片设计 → A+模块 → SEO
  // ================================================================
  {
    id: 'product_detail_page',
    name: '产品详情页生成',
    description:
      '输入产品信息 → 自动分析竞品详情页 → 生成文案（标题/卖点/规格/FAQ）→ 设计图片布局建议 → A+模块内容 → SEO 关键词优化。支持 Shopify/淘宝/独立站。',
    icon: 'image',
    category: 'production',
    estimated_tokens: 7000,
    steps: [
      {
        id: 'step-1-research',
        agent_id: 'researcher',
        mode: 'pipeline',
        input_transform:
          '分析同类目 TOP10 竞品详情页：标题结构/卖点排列/图片风格/A+模块/价格锚点/评价关键词。输出差异化策略。',
      },
      {
        id: 'step-2-copy',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成产品文案：①5个标题备选（含SEO关键词）②核心卖点（5~8条）③产品描述（场景化）④规格参数表 ⑤FAQ（8~12条）⑥品牌故事。',
      },
      {
        id: 'step-3-visual',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成视觉方案：主图构图建议（6张）/详情页分屏脚本（10~15屏）/A+模块布局方案（对比表+场景图+细节图）/视频拍摄分镜（15~30秒）。',
      },
      {
        id: 'step-4-seo',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          'SEO 优化：标题关键词密度检查/Search Terms 生成/图片 ALT 标签/ Meta Description / 结构化数据（JSON-LD）/ 内链建议。',
      },
    ],
  },

  // ================================================================
  // 11. 供应链智能预警 — 库存/物流/质检一体化
  //  场景：实时监控供应链各环节，提前预警风险
  //  执行链：数据采集 → 异常检测 → 风险评估 → 应对方案
  // ================================================================
  {
    id: 'supply_chain_alert',
    name: '供应链智能预警',
    description:
      '接入 ERP/WMS 数据 → 实时监控库存周转/物流时效/质检合格率 → 异常自动检测 → 风险评估（缺货/积压/延误）→ 生成应对方案和采购建议。',
    icon: 'globe',
    category: 'operation',
    estimated_tokens: 4000,
    steps: [
      {
        id: 'step-1-monitor',
        agent_id: 'researcher',
        mode: 'parallel',
        children: [
          {
            id: 'step-1a-stock',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '检查库存数据：低库存SKU（<安全库存）/滞销SKU（>90天未动销）/爆款补货需求预测。输出预警清单。',
          },
          {
            id: 'step-1b-logistics',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '检查物流数据：在途超时订单/妥投率下降/退货率异常/物流差评突增。输出风险清单。',
          },
        ],
      },
      {
        id: 'step-2-assess',
        agent_id: 'analyst',
        mode: 'pipeline',
        input_transform:
          '风险评估：按紧急程度（P0/P1/P2）分类 → 影响面估算（缺货GMV损失/积压仓储成本）→ 根因分析（供应商/季节/促销/物流商）。输出风险矩阵。',
      },
      {
        id: 'step-3-action',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成应对方案：①紧急采购清单（供应商/价格/交期对比）②库存调拨建议（跨仓/跨店）③促销清仓方案 ④物流商切换评估。每项含执行步骤和预期效果。',
      },
    ],
  },

  // ================================================================
  // 12. 多平台直播复盘 — 直播数据深度分析
  //  场景：直播结束后自动生成复盘报告
  //  执行链：数据拉取 → 流量分析 → 转化诊断 → 优化建议
  // ================================================================
  {
    id: 'livestream_review',
    name: '多平台直播复盘',
    description:
      '直播结束后 → 自动拉取抖音/淘宝/视频号直播数据 → 流量分析（来源/留存/峰值）→ 转化诊断（商品点击/加购/成交）→ 竞品对比 → 下场优化建议。',
    icon: 'bar-chart-3',
    category: 'analytics',
    estimated_tokens: 5000,
    steps: [
      {
        id: 'step-1-data',
        agent_id: 'researcher',
        mode: 'parallel',
        children: [
          {
            id: 'step-1a-metrics',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '拉取直播核心指标：观看人次/最高在线/平均停留/新增粉丝/互动率（评论+点赞+分享）/音浪/成交额。',
          },
          {
            id: 'step-1b-flow',
            agent_id: 'researcher',
            mode: 'pipeline',
            input_transform: '拉取流量数据：自然流量 vs 付费流量占比/流量来源渠道/每分钟在线人数曲线/观众画像（年龄/性别/地域）。',
          },
        ],
      },
      {
        id: 'step-2-diagnose',
        agent_id: 'analyst',
        mode: 'pipeline',
        input_transform:
          '转化诊断：商品讲解时长 vs 成交转化率/哪个品讲得最好/哪个品流失最多/客单价 vs 件单价/优惠券核销率。对标上一场和同行均值。',
      },
      {
        id: 'step-3-optimize',
        agent_id: 'writer',
        mode: 'pipeline',
        input_transform:
          '生成复盘报告：①核心数据仪表盘 ②流量-转化漏斗诊断 ③TOP3 亮点和问题 ④下场优化清单（排品顺序/话术调整/时长分配/投放策略）⑤竞品直播间对比分析。',
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
