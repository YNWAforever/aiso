'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function PricingPage() {
  const [loading, setLoading] = useState(false)
  const { lang } = useParams<{ lang: string }>()

  const startProCheckout = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro' }),
      })
      if (res.status === 401) {
        window.location.href = `/${lang}/auth/login?next=/${lang}/pricing`
        return
      }
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <Link href={`/${lang}`} className="font-black text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </Link>
        <Link href={`/${lang}/auth/login`} className="text-sm text-slate-500 hover:text-slate-900">
          Sign in
        </Link>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black text-slate-900">
            Know where your brand stands in AI search
          </h1>
          <p className="text-slate-500 mt-3 max-w-xl mx-auto">
            Track your Share of Voice across ChatGPT, Perplexity, Claude, and Gemini — every week, automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Starter */}
          <div className="bg-white rounded-2xl border border-slate-200 p-7">
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Starter</p>
            <p className="text-3xl font-black text-slate-900 mt-2">Free</p>
            <p className="text-xs text-slate-400 mt-1">No credit card needed</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-600">
              {['3 AEO scans / month', 'AI Fix Pack', '1 brand', '4-week Pulse history'].map(f => (
                <li key={f} className="flex gap-2"><span className="text-green-500">✓</span>{f}</li>
              ))}
              {['Prompt editing', 'Alerts'].map(f => (
                <li key={f} className="flex gap-2 text-slate-300"><span>–</span>{f}</li>
              ))}
            </ul>
            <Link
              href={`/${lang}/auth/login`}
              className="mt-8 block text-center bg-slate-100 text-slate-700 rounded-xl py-3 text-sm font-semibold hover:bg-slate-200 transition"
            >
              Get Started Free
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-slate-900 rounded-2xl border-2 border-blue-500 p-7 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              MOST POPULAR
            </div>
            <p className="text-xs font-bold tracking-widest text-blue-400 uppercase">Pro</p>
            <p className="text-3xl font-black text-white mt-2">$99<span className="text-base font-normal text-slate-400">/mo</span></p>
            <p className="text-xs text-slate-500 mt-1">Billed monthly</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              {['Unlimited AEO scans', 'AI Fix Pack', '1 brand', '6-month history', '✏️ Edit prompt bank', '🔔 SoV alerts', '📊 Competitor benchmarking'].map(f => (
                <li key={f} className="flex gap-2"><span className="text-green-400">✓</span>{f}</li>
              ))}
            </ul>
            <button
              onClick={startProCheckout}
              disabled={loading}
              className="mt-8 w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition"
            >
              {loading ? 'Loading…' : 'Start Pro →'}
            </button>
          </div>

          {/* Enterprise */}
          <div className="bg-white rounded-2xl border border-slate-200 p-7">
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Enterprise</p>
            <p className="text-3xl font-black text-slate-900 mt-2">Custom</p>
            <p className="text-xs text-slate-400 mt-1">Talk to our team</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-600">
              {['Everything in Pro', 'Up to 10 brands', 'Unlimited history + CSV', '📄 White-label PDF reports', '⚡ API access', '🤖 Custom AI platforms', 'Dedicated support'].map(f => (
                <li key={f} className="flex gap-2"><span className="text-green-500">✓</span>{f}</li>
              ))}
            </ul>
            <a
              href="mailto:aeo@fimmick.com"
              className="mt-8 block text-center bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-700 transition"
            >
              Contact Sales
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
