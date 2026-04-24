'use client'
import { useState, useEffect } from 'react'
import type { AlertConfig } from '@/lib/types'

interface Props { clientId: string }

function Toggle({ active, onChange }: { active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!active)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${active ? 'bg-green-500' : 'bg-slate-300'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition ${active ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

export function AlertsTab({ clientId }: Props) {
  const [config, setConfig]   = useState<AlertConfig | null>(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/dashboard/clients/${clientId}/alerts`)
      .then(r => r.json())
      .then(({ config }) => { setConfig(config); setLoading(false) })
  }, [clientId])

  const update = (patch: Partial<AlertConfig>) =>
    setConfig(prev => prev ? { ...prev, ...patch } : prev)

  const save = async () => {
    if (!config) return
    setSaving(true); setSaved(false)
    await fetch(`/api/dashboard/clients/${clientId}/alerts`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">Loading…</div>
  if (!config) return null

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm font-bold text-slate-800 mb-5">Alert Conditions</p>

        {/* SoV threshold */}
        <div className="mb-6 pb-6 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">SoV drops below threshold</span>
            <Toggle active={config.enabled_sov} onChange={v => update({ enabled_sov: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Alert when SoV falls below</span>
            <input type="number" min={1} max={100} value={config.sov_threshold}
              onChange={e => update({ sov_threshold: parseInt(e.target.value) || 50 })}
              disabled={!config.enabled_sov}
              className="w-16 border border-slate-200 rounded px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40" />
            <span className="text-sm text-slate-500">%</span>
          </div>
        </div>

        {/* WoW drop */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">Week-over-week drop</span>
            <Toggle active={config.enabled_wow} onChange={v => update({ enabled_wow: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Alert when SoV drops more than</span>
            <input type="number" min={1} max={100} value={config.wow_threshold}
              onChange={e => update({ wow_threshold: parseInt(e.target.value) || 10 })}
              disabled={!config.enabled_wow}
              className="w-16 border border-slate-200 rounded px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40" />
            <span className="text-sm text-slate-500">points in one week</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm font-bold text-slate-800 mb-4">Delivery</p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={config.notify_email} onChange={e => update({ notify_email: e.target.checked })}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-slate-700">Email notification</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={config.notify_inapp} onChange={e => update({ notify_inapp: e.target.checked })}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-slate-700">In-app notification</span>
          </label>
        </div>
        <button onClick={save} disabled={saving}
          className="mt-5 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Alerts'}
        </button>
      </div>
    </div>
  )
}
