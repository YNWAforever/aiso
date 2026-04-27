'use client'
import { useState } from 'react'

export function SaveScanButton({ scanId, lang }: { scanId: string; lang: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const save = async () => {
    setState('saving')
    const res = await fetch(`/api/scans/${scanId}/claim`, { method: 'POST' })
    setState(res.ok ? 'saved' : 'error')
  }

  if (state === 'saved') {
    return (
      <a
        href={`/${lang}/dashboard`}
        className="inline-flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 font-medium"
      >
        ✓ Saved — View in Dashboard →
      </a>
    )
  }

  return (
    <button
      onClick={save}
      disabled={state === 'saving'}
      className="inline-flex items-center gap-2 text-sm text-slate-700 bg-white border border-slate-300 rounded-lg px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-60 transition"
    >
      {state === 'saving' ? 'Saving…' : state === 'error' ? 'Try again' : '💾 Save to my account'}
    </button>
  )
}
