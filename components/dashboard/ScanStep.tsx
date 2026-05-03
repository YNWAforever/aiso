'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Scan } from '@/lib/types'

type Props = {
  lang: string
  clientId: string
  scan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
}

export function ScanStep({ lang, clientId, scanHistory }: Props) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [industry, setIndustry] = useState('')
  const [region, setRegion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), industry: industry || undefined, region: region || undefined, clientId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Scan failed'); setLoading(false); return }
      router.push(`/${lang}/dashboard/${clientId}?step=results&scanId=${data.id}`)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-dash-accent/10 mb-4 mx-auto block">
          <svg className="w-5 h-5 text-dash-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-dash-text mb-1 text-center">Run a new scan</p>
        <p className="text-xs text-dash-muted mb-5 text-center max-w-sm mx-auto leading-relaxed">
          Enter any URL to run a full 20-check diagnostic across all AI search platforms.
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
              <option value="">Industry (optional)</option>
              <option value="finance">Finance</option>
              <option value="medical">Medical</option>
              <option value="legal">Legal</option>
              <option value="technology">Technology</option>
              <option value="retail_ecommerce">Retail & Ecommerce</option>
              <option value="travel_hospitality">Travel & Hospitality</option>
              <option value="education">Education</option>
              <option value="real_estate">Real Estate</option>
              <option value="manufacturing">Manufacturing</option>
              <option value="media_entertainment">Media & Entertainment</option>
              <option value="general_b2b">General B2B</option>
              <option value="general_b2c">General B2C</option>
            </select>
            <select
              value={region}
              onChange={e => setRegion(e.target.value)}
              className="flex-1 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2.5 text-xs text-dash-text font-mono focus:outline-none focus:border-dash-accent transition-colors appearance-none"
            >
              <option value="">Region (optional)</option>
              <option value="global">Global</option>
              <option value="HK">Hong Kong</option>
              <option value="TW">Taiwan</option>
              <option value="SG">Singapore</option>
              <option value="JP">Japan</option>
              <option value="KR">Korea</option>
              <option value="US">United States</option>
              <option value="UK">United Kingdom</option>
              <option value="EU">Europe</option>
              <option value="AU">Australia</option>
              <option value="CA">Canada</option>
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
            {loading ? 'Scanning...' : 'Run Scan'}
          </button>
        </form>
      </div>

      {!scanHistory.length && (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-3">How it works</p>
          <div className="space-y-3">
            {[
              { num: '1', text: 'Enter any URL above and click Run Scan' },
              { num: '2', text: 'Get instant results across 20 AI readiness checks' },
              { num: '3', text: 'Review your diagnostic in the Results tab here' },
              { num: '4', text: 'AI agents give fix recommendations in Improve' },
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
          <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-3">Recent Scans</p>
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
