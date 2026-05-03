import Link from 'next/link'
import type { Scan } from '@/lib/types'

type Props = {
  lang: string
  scan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
}

export function ScanStep({ lang, scan, scanHistory }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#00d4ff12] mb-4">
          <svg className="w-5 h-5 text-[#00d4ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-[#e0e0ec] mb-1">Run a New Scan</p>
        <p className="text-xs text-[#5c5c6e] mb-5 font-mono">Analyze any URL across 20 AI readiness checks</p>
        <Link href={`/${lang}`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-[#050510] bg-[#00d4ff] hover:bg-[#00e5ff] transition-colors">
          Start Scan →
        </Link>
      </div>

      {scanHistory.length > 0 && (
        <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-4">
          <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-3">Recent Scans</p>
          <div className="space-y-1.5">
            {scanHistory.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#141422] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-[#8c8c9e] font-mono truncate">{s.domain}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] text-[#5c5c6e] font-mono">{new Date(s.created_at).toLocaleDateString()}</span>
                  <span className={`text-[11px] font-semibold font-mono ${s.score >= 80 ? 'text-[#22c55e]' : s.score >= 50 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>{s.score}</span>
                  {s.grade && <span className="text-[10px] font-bold text-[#5c5c6e]">{s.grade}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
