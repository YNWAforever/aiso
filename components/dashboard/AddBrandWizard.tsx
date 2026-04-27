'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  lang: string
  disabled?: boolean
  plan?: string
}

const INDUSTRIES = [
  'Marketing & Advertising', 'Technology', 'Finance & Banking',
  'Healthcare', 'Retail & E-commerce', 'Real Estate', 'Education', 'Other',
]

export function AddBrandWizard({ lang, disabled, plan }: Props) {
  const [open, setOpen]               = useState(false)
  const [step, setStep]               = useState(1)
  const [name, setName]               = useState('')
  const [domain, setDomain]           = useState('')
  const [industry, setIndustry]       = useState('')
  const [competitors, setCompetitors] = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const router = useRouter()

  const reset = () => { setStep(1); setName(''); setDomain(''); setIndustry(''); setCompetitors(''); setError('') }
  const close = () => { reset(); setOpen(false) }

  const submitStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setStep(2)
  }

  const submitStep2 = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/dashboard/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_name:  name.trim(),
        domain:      domain.trim() || null,
        industry:    industry || null,
        competitors: competitors.split(',').map(s => s.trim()).filter(Boolean),
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error === 'BRAND_LIMIT_REACHED'
        ? `You've reached the ${data.limit}-brand limit on your ${data.plan} plan. Upgrade to add more.`
        : 'Something went wrong. Please try again.')
      setLoading(false); return
    }
    router.refresh(); close(); setLoading(false)
  }

  if (disabled) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
        <p className="text-sm font-semibold text-slate-500 mb-1">Brand limit reached</p>
        <p className="text-xs text-slate-400 mb-4">
          Your {plan ?? 'current'} plan allows {plan === 'starter' ? '1 brand' : plan === 'pro' ? '3 brands' : '10 brands'}.
        </p>
        <a href={`/${lang}/pricing`} className="inline-block bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          Upgrade to Enterprise →
        </a>
      </div>
    )
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition">
        + Add Brand
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">Add Brand</h2>
                <p className="text-xs text-slate-400">Step {step} of 2</p>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>

            {step === 1 && (
              <form onSubmit={submitStep1} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Brand Name *</label>
                  <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Fimmick HK" required
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Website Domain</label>
                  <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="fimmick.com (optional)"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={close} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
                  <button type="submit" disabled={!name.trim()} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">Next →</button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={submitStep2} className="px-6 py-5 space-y-4">
                {error && <p className="text-red-600 text-sm bg-red-50 rounded-lg p-3">{error}</p>}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Industry</label>
                  <select value={industry} onChange={e => setIndustry(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    <option value="">Select industry (optional)</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Competitors</label>
                  <input value={competitors} onChange={e => setCompetitors(e.target.value)}
                    placeholder="Ogilvy, McCann, TBWA (comma-separated, optional)"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-slate-400 mt-1">Used to track competitor mentions in AI responses.</p>
                </div>
                <p className="text-xs text-slate-400 bg-blue-50 rounded-lg p-3">
                  🔄 Weekly AI pulse monitoring will begin automatically on the next scan run.
                </p>
                <div className="flex justify-between gap-2 pt-2">
                  <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">← Back</button>
                  <button type="submit" disabled={loading} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                    {loading ? 'Adding…' : 'Add Brand →'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
