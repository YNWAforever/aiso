'use client'
import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { AlertConfig } from '@/lib/types'

interface Props { clientId: string }

function isConfig(value: unknown, clientId: string): value is AlertConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Record<string, unknown>
  return config.client_id === clientId
    && ['enabled_sov', 'enabled_wow', 'notify_email', 'notify_inapp'].every(key => typeof config[key] === 'boolean')
    && ['sov_threshold', 'wow_threshold'].every(key => typeof config[key] === 'number' && Number.isInteger(config[key]) && Number(config[key]) >= 0 && Number(config[key]) <= 100)
}

function Toggle({ active, onChange, label, disabled }: { active: boolean; onChange: (v: boolean) => void; label: string; disabled: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={active} aria-label={label} disabled={disabled} onClick={() => onChange(!active)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
      <span className={`relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors ${active ? 'bg-green-500' : 'bg-muted'}`}>
        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow transform transition ${active ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
    </button>
  )
}

export function AlertsTab({ clientId }: Props) {
  const t = useTranslations('dashboard')
  const feedback = useTranslations('alertFeedback')
  const [config, setConfig]     = useState<AlertConfig | null>(null)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [fetchErr, setFetchErr] = useState(false)
  const [saveErr, setSaveErr] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const pending = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    generation.current += 1
    pending.current = false
    async function load() {
      try {
        const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/alerts`)
        if (!response.ok) throw new Error('load failed')
        const data = await response.json()
        if (!isConfig(data?.config, clientId)) throw new Error('invalid config')
        if (active) { setConfig(data.config); setFetchErr(false) }
      } catch {
        if (active) { setConfig(null); setFetchErr(true) }
      } finally {
        if (active) { setLoading(false); setSaving(false); setSaved(false); setSaveErr(false) }
      }
    }
    void load()
    return () => { active = false; generation.current += 1 }
  }, [clientId, attempt])

  const update = (patch: Partial<AlertConfig>) => {
    if (pending.current) return
    setSaved(false)
    setSaveErr(false)
    setConfig(prev => prev ? { ...prev, ...patch } : prev)
  }

  const save = async () => {
    if (!config || config.client_id !== clientId || pending.current || loading) return
    const requestGeneration = generation.current
    pending.current = true
    setSaving(true)
    setSaved(false)
    setSaveErr(false)
    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/alerts`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!response.ok) throw new Error('save failed')
      const data = await response.json()
      if (!isConfig(data?.config, clientId)) throw new Error('invalid config')
      if (generation.current !== requestGeneration) return
      setConfig(data.config)
      setSaved(true)
    } catch {
      if (generation.current === requestGeneration) setSaveErr(true)
    } finally {
      if (generation.current === requestGeneration) {
        pending.current = false
        setSaving(false)
      }
    }
  }

  if (loading || (config && config.client_id !== clientId)) return <div role="status" className="bg-card rounded-xl border p-8 text-center text-sm text-muted-foreground">{t('alerts_loading')}</div>
  if (fetchErr || !config) return <div role="status" className="bg-card rounded-xl border border-destructive/30 p-8 text-center text-sm text-destructive">
    <p>{feedback('loadFailed')}</p>
    <Button className="mt-3 min-h-11" onClick={() => { setLoading(true); setFetchErr(false); setAttempt(value => value + 1) }}>{feedback('retry')}</Button>
  </div>

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-6">
        <p className="text-sm font-bold text-foreground mb-5">{t('alerts_conditions')}</p>

        {/* SoV threshold */}
        <div className="mb-6 pb-6 border-b">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">{t('alerts_sov_title')}</span>
            <Toggle label={t('alerts_sov_title')} disabled={saving} active={config.enabled_sov} onChange={v => update({ enabled_sov: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('alerts_sov_prefix')}</span>
            <input type="number" aria-label={t('alerts_sov_title')} min={0} max={100} value={config.sov_threshold}
              onChange={e => update({ sov_threshold: Math.min(100, Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })}
              disabled={saving || !config.enabled_sov}
              className="w-16 border border-border rounded px-2 py-1 text-sm font-bold text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 bg-input text-foreground" />
            <span className="text-sm text-muted-foreground">{t('alerts_sov_suffix')}</span>
          </div>
        </div>

        {/* WoW drop */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">{t('alerts_wow_title')}</span>
            <Toggle label={t('alerts_wow_title')} disabled={saving} active={config.enabled_wow} onChange={v => update({ enabled_wow: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('alerts_wow_prefix')}</span>
            <input type="number" aria-label={t('alerts_wow_title')} min={0} max={100} value={config.wow_threshold}
              onChange={e => update({ wow_threshold: Math.min(100, Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })}
              disabled={saving || !config.enabled_wow}
              className="w-16 border border-border rounded px-2 py-1 text-sm font-bold text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 bg-input text-foreground" />
            <span className="text-sm text-muted-foreground">{t('alerts_wow_suffix')}</span>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border p-6">
        <p className="text-sm font-bold text-foreground mb-4">{t('alerts_delivery')}</p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" disabled={saving} checked={config.notify_email} onChange={e => update({ notify_email: e.target.checked })}
              className="w-4 h-4 rounded accent-primary" />
            <span className="text-sm text-foreground">{t('alerts_email')}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" disabled={saving} checked={config.notify_inapp} onChange={e => update({ notify_inapp: e.target.checked })}
              className="w-4 h-4 rounded accent-primary" />
            <span className="text-sm text-foreground">{t('alerts_inapp')}</span>
          </label>
        </div>
        <Button onClick={save} disabled={saving} className="mt-5 min-h-11">
          {saving ? t('alerts_saving') : saved ? t('alerts_saved') : t('alerts_save')}
        </Button>
        <p role="status" className="mt-2 text-sm">{saveErr ? feedback('saveFailed') : saved ? t('alerts_saved') : null}</p>
      </div>
    </div>
  )
}
