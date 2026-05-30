'use client'
import { useState } from 'react'
import { Mail, ChevronRight, BarChart2, ShieldCheck, FileText } from 'lucide-react'

interface Props {
  scanId: string
  onUnlocked: (email: string) => void
}

export function EmailCaptureGate({ scanId, onUnlocked }: Props) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/scan/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, email }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed')
      }
      onUnlocked(email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-center">
      <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
        <Mail className="size-6 text-primary" />
      </div>
      <h2 className="text-white font-black text-xl mb-2">Get your full AI Visibility Report</h2>
      <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
        Enter your email to unlock all 20 checks, deep GEO analysis, and your personalised fix plan.
      </p>

      {/* Unlock list */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center mb-7">
        {[
          { icon: ShieldCheck, label: 'All 20 checks breakdown' },
          { icon: BarChart2,   label: 'Deep GEO analysis' },
          { icon: FileText,    label: 'Personalised fix plan' },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 text-xs text-slate-300 font-medium">
            <Icon className="size-3.5 text-primary shrink-0" />
            {label}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-sm mx-auto">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="flex-1 h-11 rounded-lg border border-white/10 bg-white/10 text-white placeholder:text-slate-500 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition flex items-center gap-1.5 shrink-0 justify-center disabled:opacity-60"
        >
          {loading ? 'Unlocking…' : 'Unlock report'}
          {!loading && <ChevronRight className="size-4" />}
        </button>
      </form>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      <p className="text-slate-500 text-xs mt-4">No spam. One-time send. Unsubscribe anytime.</p>
    </div>
  )
}
