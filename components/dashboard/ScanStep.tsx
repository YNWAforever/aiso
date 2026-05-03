import Link from 'next/link'
import type { Scan } from '@/lib/types'

type Props = {
  lang: string
  scan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
}

export function ScanStep({ lang, scanHistory }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-dash-accent/10 mb-4">
          <svg className="w-5 h-5 text-dash-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-dash-text mb-1">Run a new scan</p>
        <p className="text-xs text-dash-muted mb-5 max-w-sm mx-auto leading-relaxed">
          Enter any URL on the homepage to run a full 20-check diagnostic. We will check how visible your page is to ChatGPT, Claude, Gemini, and Perplexity.
        </p>
        <Link
          href={`/${lang}`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-primary-foreground bg-dash-accent hover:opacity-90 transition-opacity"
        >
          Open scanner →
        </Link>
      </div>

      {!scanHistory.length && (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-3">How it works</p>
          <div className="space-y-3">
            {[
              { num: '1', text: 'Paste any URL on the homepage scanner' },
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
              <div key={s.id} className="flex items-center justify-between py-2 px-3 rounded hover:bg-dash-elevated transition-colors">
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
