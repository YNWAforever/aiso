'use client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { AlertConfig } from '@/lib/types'

interface Props { clientId: string }

function Toggle({ active, onChange }: { active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!active)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${active ? 'bg-green-500' : 'bg-muted'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow transform transition ${active ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

export function AlertsTab({ clientId }: Props) {
  const t = useTranslations('dashboard')
  const [config, setConfig]     = useState<AlertConfig | null>(null)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [fetchErr, setFetchErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/dashboard/clients/${clientId}/alerts`)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load alert config (${r.status})`)
        return r.json()
      })
      .then(({ config }) => { setConfig(config); setLoading(false) })
      .catch(err => { setFetchErr(err.message ?? 'Unknown error'); setLoading(false) })
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

  if (loading)   return <div className="bg-card rounded-xl border p-8 text-center text-sm text-muted-foreground">{t('alerts_loading')}</div>
  if (fetchErr)  return <div className="bg-card rounded-xl border border-destructive/30 p-8 text-center text-sm text-destructive">{fetchErr}</div>
  if (!config)   return null

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-6">
        <p className="text-sm font-bold text-foreground mb-5">{t('alerts_conditions')}</p>

        {/* SoV threshold */}
        <div className="mb-6 pb-6 border-b">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">{t('alerts_sov_title')}</span>
            <Toggle active={config.enabled_sov} onChange={v => update({ enabled_sov: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('alerts_sov_prefix')}</span>
            <input type="number" min={1} max={100} value={config.sov_threshold}
              onChange={e => update({ sov_threshold: parseInt(e.target.value) || 50 })}
              disabled={!config.enabled_sov}
              className="w-16 border border-border rounded px-2 py-1 text-sm font-bold text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 bg-input text-foreground" />
            <span className="text-sm text-muted-foreground">{t('alerts_sov_suffix')}</span>
          </div>
        </div>

        {/* WoW drop */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">{t('alerts_wow_title')}</span>
            <Toggle active={config.enabled_wow} onChange={v => update({ enabled_wow: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('alerts_wow_prefix')}</span>
            <input type="number" min={1} max={100} value={config.wow_threshold}
              onChange={e => update({ wow_threshold: parseInt(e.target.value) || 10 })}
              disabled={!config.enabled_wow}
              className="w-16 border border-border rounded px-2 py-1 text-sm font-bold text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 bg-input text-foreground" />
            <span className="text-sm text-muted-foreground">{t('alerts_wow_suffix')}</span>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border p-6">
        <p className="text-sm font-bold text-foreground mb-4">{t('alerts_delivery')}</p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={config.notify_email} onChange={e => update({ notify_email: e.target.checked })}
              className="w-4 h-4 rounded accent-primary" />
            <span className="text-sm text-foreground">{t('alerts_email')}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={config.notify_inapp} onChange={e => update({ notify_inapp: e.target.checked })}
              className="w-4 h-4 rounded accent-primary" />
            <span className="text-sm text-foreground">{t('alerts_inapp')}</span>
          </label>
        </div>
        <Button onClick={save} disabled={saving} className="mt-5">
          {saving ? t('alerts_saving') : saved ? t('alerts_saved') : t('alerts_save')}
        </Button>
      </div>
    </div>
  )
}
