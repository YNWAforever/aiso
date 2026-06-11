'use client'
import { useState } from 'react'
import { useLocale } from 'next-intl'
import { Mail, ChevronRight, BarChart2, ShieldCheck, FileText } from 'lucide-react'

const COPY_EN = {
  title: 'Get your full AI Visibility Report',
  subtitle: 'Enter your email to unlock all 20 checks, deep GEO analysis, and your personalised fix plan.',
  benefit1: 'All 20 checks breakdown',
  benefit2: 'Deep GEO analysis',
  benefit3: 'Personalised fix plan',
  placeholder: 'you@company.com',
  unlocking: 'Unlocking…',
  unlock: 'Unlock report',
  genericError: 'Something went wrong',
  noSpam: 'No spam. One-time send. Unsubscribe anytime.',
}

const COPY_ZH_HK: typeof COPY_EN = {
  title: '取得你的完整 AI 可見度報告',
  subtitle: '輸入電郵即可解鎖全部 20 項檢查、深度 GEO 分析，以及你的個人化修復計劃。',
  benefit1: '全部 20 項檢查詳情',
  benefit2: '深度 GEO 分析',
  benefit3: '個人化修復計劃',
  placeholder: 'you@company.com',
  unlocking: '解鎖中…',
  unlock: '解鎖報告',
  genericError: '發生錯誤，請再試一次',
  noSpam: '不會濫發郵件，只發送一次，隨時可取消訂閱。',
}

interface Props {
  scanId: string
  onUnlocked: (email: string) => void
}

export function EmailCaptureGate({ scanId, onUnlocked }: Props) {
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
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
      setError(err instanceof Error ? err.message : c.genericError)
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-center">
      <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
        <Mail className="size-6 text-primary" />
      </div>
      <h2 className="text-white font-black text-xl mb-2">{c.title}</h2>
      <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
        {c.subtitle}
      </p>

      {/* Unlock list */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center mb-7">
        {[
          { icon: ShieldCheck, label: c.benefit1 },
          { icon: BarChart2,   label: c.benefit2 },
          { icon: FileText,    label: c.benefit3 },
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
          placeholder={c.placeholder}
          className="flex-1 h-11 rounded-lg border border-white/10 bg-white/10 text-white placeholder:text-slate-500 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition flex items-center gap-1.5 shrink-0 justify-center disabled:opacity-60"
        >
          {loading ? c.unlocking : c.unlock}
          {!loading && <ChevronRight className="size-4" />}
        </button>
      </form>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      <p className="text-slate-500 text-xs mt-4">{c.noSpam}</p>
    </div>
  )
}
