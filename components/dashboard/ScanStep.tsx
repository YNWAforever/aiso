'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { Scan } from '@/lib/types'

const INDUSTRY_VALUES = [
  'finance', 'medical', 'legal', 'technology', 'retail_ecommerce',
  'travel_hospitality', 'education', 'real_estate', 'manufacturing',
  'media_entertainment', 'general_b2b', 'general_b2c',
] as const

const REGION_VALUES = ['global', 'HK', 'TW', 'SG', 'JP', 'KR', 'US', 'UK', 'EU', 'AU', 'CA'] as const

type Props = {
  lang: string
  clientId: string
  scan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
}

export function ScanStep({ lang, clientId, scanHistory }: Props) {
  const t            = useTranslations('dashboard')
  const router       = useRouter()
  const searchParams = useSearchParams()
  const autoUrl      = searchParams.get('url') ?? ''

  const [url, setUrl]           = useState(autoUrl)
  const [industry, setIndustry] = useState('')
  const [region, setRegion]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const autoSubmitted           = useRef(false)

  // Auto-submit when arriving from onboarding with a pre-filled URL
  useEffect(() => {
    if (autoUrl && !autoSubmitted.current && !loading) {
      autoSubmitted.current = true
      runScan(autoUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUrl])

  async function runScan(scanUrl: string) {
    if (!scanUrl.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanUrl.trim(), industry: industry || undefined, region: region || undefined, clientId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || t('scan_failed')); setLoading(false); return }
      router.push(`/${lang}/dashboard/${clientId}?step=results&scanId=${data.id}`)
    } catch {
      setError(t('network_error'))
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await runScan(url)
  }

  // If auto-scanning, show a full-screen loading state
  if (loading && autoUrl) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-10 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-dash-accent/10 mx-auto">
          <svg className="w-5 h-5 text-dash-accent animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-dash-text">{t('scanning_brand')}</p>
        <p className="text-xs text-dash-muted">{t('scanning_checks')} <span className="font-mono text-dash-accent">{autoUrl}</span></p>
        <div className="max-w-xs mx-auto h-1.5 bg-dash-elevated rounded-full overflow-hidden">
          <div className="h-full bg-dash-accent rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-dash-accent/10 mb-4 mx-auto block">
          <svg className="w-5 h-5 text-dash-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-dash-text mb-1 text-center">{t('run_new_scan')}</p>
        <p className="text-xs text-dash-muted mb-5 text-center max-w-sm mx-auto leading-relaxed">
          {t('run_new_scan_body')}
        </p>

        <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-3">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            required
            className="w-full rounded-lg border border-dash-border bg-dash-elevated px-4 py-2.5 text-sm text-dash-text placeholder:text-dash-muted/50 font-mono focus:outline-none focus:border-dash-accent transition-colors"
          />
          <div className="flex gap-2">
            <select
              value={industry}
              onChange={e => setIndustry(e.target.value)}
              className="flex-1 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2.5 text-xs text-dash-text font-mono focus:outline-none focus:border-dash-accent transition-colors appearance-none"
            >
              <option value="">{t('industry_optional')}</option>
              {INDUSTRY_VALUES.map(v => (
                <option key={v} value={v}>{t(`industries.${v}`)}</option>
              ))}
            </select>
            <select
              value={region}
              onChange={e => setRegion(e.target.value)}
              className="flex-1 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2.5 text-xs text-dash-text font-mono focus:outline-none focus:border-dash-accent transition-colors appearance-none"
            >
              <option value="">{t('region_optional')}</option>
              {REGION_VALUES.map(v => (
                <option key={v} value={v}>{t(`regions.${v}`)}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium rounded-lg text-primary-foreground bg-dash-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? t('scanning') : t('run_scan')}
          </button>
        </form>
      </div>

      {!scanHistory.length && (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-3">{t('how_it_works')}</p>
          <div className="space-y-3">
            {[
              { num: '1', text: t('how_step_1') },
              { num: '2', text: t('how_step_2') },
              { num: '3', text: t('how_step_3') },
              { num: '4', text: t('how_step_4') },
            ].map((s) => (
              <div key={s.num} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded bg-dash-accent/10 text-[10px] font-bold text-dash-accent font-mono flex items-center justify-center shrink-0 mt-px">{s.num}</span>
                <p className="text-xs text-dash-muted leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {scanHistory.length > 0 && (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-4">
          <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-3">{t('recent_scans')}</p>
          <div className="space-y-1">
            {scanHistory.map((s) => (
              <button
                key={s.id}
                onClick={() => router.push(`/${lang}/dashboard/${clientId}?step=results&scanId=${s.id}`)}
                className="w-full flex items-center justify-between py-2 px-3 rounded hover:bg-dash-elevated transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: `var(--dash-${s.score >= 80 ? 'success' : s.score >= 50 ? 'warning' : 'danger'})` }} />
                  <span className="text-[12px] text-dash-text font-mono truncate">{s.domain}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-[11px] text-dash-muted font-mono">{new Date(s.created_at).toLocaleDateString()}</span>
                  <span className={`text-[12px] font-bold font-mono ${
                    s.score >= 80 ? 'text-dash-success' : s.score >= 50 ? 'text-dash-warning' : 'text-dash-danger'
                  }`}>{s.score}</span>
                  {s.grade && <span className="text-[10px] font-bold text-dash-muted bg-dash-elevated px-1.5 py-0.5 rounded">{s.grade}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
