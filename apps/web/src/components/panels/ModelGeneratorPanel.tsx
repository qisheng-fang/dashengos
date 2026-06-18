// components/panels/ModelGeneratorPanel.tsx
// 视觉资产生成器 — 数字人 / ComfyUI 渲染面板
// ----------------------------------------------------------------------

import { useState } from 'react'
import { Upload, SlidersHorizontal, Image as ImageIcon, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function ModelGeneratorPanel() {
  const [preset, setPreset] = useState('尤娜 - 艺术写真')
  const [height, setHeight] = useState(168)

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 标题区 */}
      <div className="flex justify-between items-end border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-100 tracking-tight">
            视觉资产生成器
          </h2>
          <p className="text-neutral-500 text-sm mt-1">
            基于 3D 引擎与 ComfyUI 渲染高逼真模型
          </p>
        </div>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 text-sm rounded-md px-3 py-1.5 text-neutral-200 focus:outline-none focus:border-brand"
        >
          <option>尤娜 - 艺术写真</option>
          <option>尤娜 - 日常陪伴</option>
          <option>自定义新模型...</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* 左列：参数控制 */}
        <div className="space-y-6">
          <Card className="bg-neutral-900/50 border-neutral-800 p-5">
            <div className="flex items-center mb-4">
              <SlidersHorizontal className="w-4 h-4 text-brand mr-2" />
              <h3 className="font-medium text-sm text-neutral-200">核心身体数据</h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-neutral-400 mb-1">
                  <span>身高 (cm)</span>
                  <span className="text-brand font-mono">{height}</span>
                </div>
                <input
                  type="range"
                  min="150"
                  max="180"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full accent-brand"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">头型比例</label>
                  <select className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm text-neutral-300">
                    <option>精巧瓜子脸 (0.85)</option>
                    <option>圆润幼态 (0.9)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">发型材质</label>
                  <select className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm text-neutral-300">
                    <option>垂坠感长直发 (高光)</option>
                    <option>微卷法式 (哑光)</option>
                  </select>
                </div>
              </div>
            </div>
          </Card>

          {/* 上传区 */}
          <div className="bg-neutral-900/50 border border-dashed border-neutral-800 rounded-xl p-5 hover:border-brand/50 transition-colors cursor-pointer flex flex-col items-center justify-center py-10">
            <Upload className="w-8 h-8 text-neutral-600 mb-3" />
            <span className="text-sm text-neutral-300">拖拽目标服装图片至此</span>
            <span className="text-xs text-neutral-600 mt-1">支持 PNG, JPG (最大 10MB)</span>
          </div>
        </div>

        {/* 右列：渲染预览 */}
        <Card className="bg-neutral-900 border-neutral-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-neutral-800 flex justify-between items-center bg-neutral-950">
            <span className="text-xs text-neutral-400 flex items-center">
              <ImageIcon className="w-3 h-3 mr-1" /> 渲染预览室
            </span>
            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              GPU Ready
            </span>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-[300px] bg-neutral-950">
            <div className="text-center">
              <div className="w-32 h-48 border border-neutral-700 bg-neutral-800/50 rounded-lg mx-auto mb-3 flex items-center justify-center shadow-2xl">
                <span className="text-neutral-600 text-xs">Waiting for execution...</span>
              </div>
            </div>
          </div>
          <div className="p-4 bg-neutral-950">
            <Button className="w-full" size="lg">
              <Sparkles className="w-4 h-4 mr-2" />
              执行合成流 (Cost: 1.2 Credits)
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
