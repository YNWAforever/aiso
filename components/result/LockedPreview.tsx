'use client'
import { Lock } from 'lucide-react'

export function LockedPreview({ checkCount }: { checkCount: number }) {
  const fakeRows = [
    { label: 'Heading structure', status: 'warn' },
    { label: 'Internal link graph', status: 'fail' },
    { label: 'Entity signals',     status: 'pass' },
    { label: 'Meta descriptions',  status: 'warn' },
  ]

  return (
    <div className="relative rounded-2xl border border-slate-200 overflow-hidden">
      {/* Blurred rows */}
      <div className="bg-white p-5 select-none pointer-events-none" aria-hidden>
        <p className="text-xs font-bold text-slate-400 tracking-widest mb-4">ALL {checkCount} CHECKS</p>
        <div className="space-y-3 blur-sm">
          {fakeRows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50">
              <div className={`size-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                r.status === 'pass' ? 'bg-emerald-100 text-emerald-600' :
                r.status === 'warn' ? 'bg-amber-100 text-amber-600' :
                'bg-red-100 text-red-600'
              }`}>
                {r.status === 'pass' ? '✓' : r.status === 'warn' ? '!' : '✗'}
              </div>
              <span className="text-sm text-slate-700 flex-1">{r.label}</span>
              <div className="h-2 w-24 rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[2px]">
        <div className="size-10 rounded-xl bg-slate-900 flex items-center justify-center mb-3">
          <Lock className="size-4 text-white" />
        </div>
        <p className="text-sm font-bold text-slate-900">{checkCount} checks analysed</p>
        <p className="text-xs text-slate-500 mt-1">Enter your email above to unlock all results</p>
      </div>
    </div>
  )
}
