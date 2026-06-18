// components/panels/S2B2CDeployPanel.tsx
// S2B2C 跨境架构部署面板 — Gemini 未提供，新建占位
// ----------------------------------------------------------------------

import { useState } from 'react'
import { Globe, Server, ShoppingBag, Shield, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const REGIONS = [
  { id: 'hk', label: '中国香港', latency: '12ms', flag: '🇭🇰' },
  { id: 'sg', label: '新加坡', latency: '35ms', flag: '🇸🇬' },
  { id: 'us', label: '美西 (Oregon)', latency: '180ms', flag: '🇺🇸' },
  { id: 'jp', label: '东京', latency: '45ms', flag: '🇯🇵' },
]

export default function S2B2CDeployPanel() {
  const [region, setRegion] = useState('hk')
  const [shopName, setShopName] = useState('aiyouqu-store')
  const [deploying, setDeploying] = useState(false)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 标题区 */}
      <div className="border-b border-neutral-800 pb-4">
        <h2 className="text-2xl font-semibold text-neutral-100 tracking-tight">
          S2B2C 跨境架构部署
        </h2>
        <p className="text-neutral-500 text-sm mt-1">
          一键部署独立站 + 海外节点 + 供应链中台
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 左列：配置 */}
        <div className="space-y-4">
          {/* 店铺配置 */}
          <Card className="bg-neutral-900/50 border-neutral-800 p-5">
            <div className="flex items-center mb-3">
              <ShoppingBag className="w-4 h-4 text-brand mr-2" />
              <h3 className="font-medium text-sm text-neutral-200">店铺配置</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">独立站域名</label>
                <div className="flex items-center gap-2">
                  <input
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-brand font-mono focus:outline-none focus:border-brand"
                  />
                  <span className="text-xs text-neutral-600">.myshopify.com</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">支付网关</label>
                <select className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-300">
                  <option>Stripe (全球)</option>
                  <option>PayPal Express</option>
                  <option>支付宝国际版</option>
                </select>
              </div>
            </div>
          </Card>

          {/* 区域选择 */}
          <Card className="bg-neutral-900/50 border-neutral-800 p-5">
            <div className="flex items-center mb-3">
              <Globe className="w-4 h-4 text-brand mr-2" />
              <h3 className="font-medium text-sm text-neutral-200">边缘节点</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {REGIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRegion(r.id)}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors',
                    region === r.id
                      ? 'border-brand bg-brand/10 text-neutral-100'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">{r.flag}</span>
                    {r.label}
                  </span>
                  <span className="text-[10px] text-neutral-600 font-mono">{r.latency}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* 安全配置 */}
          <Card className="bg-neutral-900/50 border-neutral-800 p-5">
            <div className="flex items-center mb-3">
              <Shield className="w-4 h-4 text-brand mr-2" />
              <h3 className="font-medium text-sm text-neutral-200">合规与安全</h3>
            </div>
            <div className="space-y-2 text-xs text-neutral-400">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="accent-brand" />
                GDPR 合规cookie横幅
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="accent-brand" />
                SSL 证书自动签发 (Let's Encrypt)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-brand" />
                PCI-DSS 支付合规扫描
              </label>
            </div>
          </Card>
        </div>

        {/* 右列：部署状态 */}
        <div className="space-y-4">
          <Card className="bg-neutral-900 border-neutral-800 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-neutral-800 flex items-center bg-neutral-950">
              <Server className="w-3 h-3 text-neutral-400 mr-2" />
              <span className="text-xs text-neutral-400">部署拓扑预览</span>
            </div>
            <div className="p-6 space-y-4">
              {/* 拓扑图 */}
              <div className="flex flex-col items-center gap-3 text-sm">
                <div className="px-4 py-2 bg-brand/10 border border-brand/30 rounded-lg text-brand">
                  用户端 (CDN)
                </div>
                <div className="text-neutral-600 text-xs">|</div>
                <div className="px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300">
                  独立站 (Shopify)
                </div>
                <div className="text-neutral-600 text-xs">|</div>
                <div className="px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300">
                  供应链中台 (DaShengOS)
                </div>
                <div className="text-neutral-600 text-xs">|</div>
                <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                  边缘节点 ({REGIONS.find((r) => r.id === region)?.label})
                </div>
              </div>
            </div>
            <div className="p-4 bg-neutral-950 border-t border-neutral-800">
              <Button
                className="w-full"
                size="lg"
                disabled={deploying}
                onClick={() => {
                  setDeploying(true)
                  setTimeout(() => setDeploying(false), 3000)
                }}
              >
                <Rocket className="w-4 h-4 mr-2" />
                {deploying ? '部署中...' : '一键部署 S2B2C 架构'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
