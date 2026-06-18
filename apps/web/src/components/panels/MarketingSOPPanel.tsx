// components/panels/MarketingSOPPanel.tsx
// 私域内容与 SOP 规划面板
// ----------------------------------------------------------------------

import { useState } from 'react'
import { LayoutGrid, Calendar, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function MarketingSOPPanel() {
  const [tone, setTone] = useState(80) // 0=干货科普, 100=情感陪伴
  const [productType, setProductType] = useState('老班盆古树茶')
  const [generating, setGenerating] = useState(false)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-800 pb-4">
        <h2 className="text-2xl font-semibold text-neutral-100 tracking-tight">
          私域内容与 SOP 规划
        </h2>
        <p className="text-neutral-500 text-sm mt-1">
          基于产品实体的知识库强校验，自动生成 30 天 IP 执行计划
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* 左列：参数配置 */}
        <div className="col-span-1 space-y-4">
          <Card className="bg-neutral-900 border-neutral-800 rounded-lg p-4">
            <label className="block text-xs text-neutral-500 mb-2">主推产品实体锁定</label>
            <input
              type="text"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-700 rounded px-3 py-2 text-sm text-brand font-medium focus:outline-none focus:border-brand"
            />
            <p className="text-[10px] text-neutral-600 mt-2">
              系统将基于此实体进行知识库强校验，防止名词混淆。
            </p>
          </Card>

          <Card className="bg-neutral-900 border-neutral-800 rounded-lg p-4">
            <label className="block text-xs text-neutral-500 mb-3 flex justify-between">
              <span>商业叙事基调</span>
              <span className="text-neutral-300">
                {tone > 70 ? '艺术/情感' : tone < 30 ? '干货/科普' : '平衡'}
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={tone}
              onChange={(e) => setTone(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
              <span>硬核供应链</span>
              <span>生活方式/陪伴</span>
            </div>
          </Card>

          <Button
            variant="outline"
            className="w-full"
            disabled={generating}
            onClick={() => {
              setGenerating(true)
              setTimeout(() => setGenerating(false), 3000)
            }}
          >
            <Wand2 className="w-4 h-4 mr-2" />
            {generating ? '生成中...' : '生成 30 天 IP 执行计划'}
          </Button>
        </div>

        {/* 右列：生成画布 */}
        <Card className="col-span-2 bg-neutral-900 border-neutral-800 rounded-lg p-6">
          <div className="flex items-center text-sm text-neutral-400 mb-4 border-b border-neutral-800 pb-2">
            <LayoutGrid className="w-4 h-4 mr-2 text-brand" /> 生成画布
          </div>
          {/* 日历/SOP 渲染区 */}
          <div className="prose prose-invert prose-sm max-w-none text-neutral-300">
            {/* 预览模板 */}
            <div className="space-y-3">
              {['第 1 周', '第 2 周', '第 3 周', '第 4 周'].map((week, i) => (
                <div
                  key={week}
                  className="flex items-start gap-3 p-3 rounded-lg bg-neutral-950/50 border border-neutral-800"
                >
                  <Calendar className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-neutral-200">{week}</div>
                    <div className="text-xs text-neutral-500 mt-1">
                      {i === 0 && '人设建立 · 朋友圈 3 条 + 公众号长文 1 篇'}
                      {i === 1 && '场景种草 · 短视频脚本 5 条 + 社群互动话术'}
                      {i === 2 && '信任深化 · 客户案例 + 品鉴会直播脚本'}
                      {i === 3 && '转化收网 · 限时优惠 SOP + 私聊转化话术'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-neutral-600 italic text-xs mt-4">
              在此预览生成的公众号软文或社群 SOP 话术... 支持划线局部重写。
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
