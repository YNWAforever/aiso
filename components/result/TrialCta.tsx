'use client'
import { useState, type ReactNode } from 'react'
import { useLocale } from 'next-intl'
import { createBrowserClient } from '@supabase/ssr'
import { Zap, ChevronRight, Mail } from 'lucide-react'

const COPY_EN = {
  inboxTitle: 'Check your inbox',
  inboxBody: (email: ReactNode) => (
    <>We sent a magic link to {email}. Click it to start your free trial and get your Fix Pack.</>
  ),
  ctaTitle: (n: number) => `Fix your ${n} issue${n !== 1 ? 's' : ''} — free for 7 days`,
  ctaBody: 'Start your free trial to download your Fix Pack: llms.txt, robots.txt patch, and FAQ schema — ready to deploy.',
  ctaFinePrint: 'No credit card required · 7-day trial · Cancel anytime',
  sending: 'Sending magic link…',
  startTrial: (email: string) => `Start free trial — send to ${email}`,
  haveAccount: 'Already have an account?',
  signIn: 'Sign in',
}

const COPY_ZH_HK: typeof COPY_EN = {
  inboxTitle: '請查看你的收件箱',
  inboxBody: (email: ReactNode) => (
    <>我們已發送登入連結至 {email}。點擊連結即可開始免費試用並取得你的 Fix Pack。</>
  ),
  ctaTitle: (n: number) => `修復你的 ${n} 個問題——免費試用 7 天`,
  ctaBody: '開始免費試用即可下載你的 Fix Pack：llms.txt、robots.txt 修補檔及 FAQ schema——隨時可部署。',
  ctaFinePrint: '毋須信用卡 · 7 天試用 · 隨時取消',
  sending: '正在發送登入連結…',
  startTrial: (email: string) => `開始免費試用——發送至 ${email}`,
  haveAccount: '已有帳戶？',
  signIn: '登入',
}

interface Props {
  email: string        // pre-filled from email gate
  scanId: string
  lang: string
  failCount: number
}

export function TrialCta({ email, scanId, lang, failCount }: Props) {
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleStart() {
    setLoading(true)
    setError('')
    // Route through auth callback so the session cookie is set before the onboarding page loads
    const next = encodeURIComponent(`/${lang}/onboarding?scan=${scanId}`)
    const redirectTo = `${window.location.origin}/auth/callback?next=${next}`
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="bg-slate-900 rounded-2xl p-8 text-center">
        <div className="size-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
          <Mail className="size-6 text-emerald-400" />
        </div>
        <h2 className="text-white font-black text-xl mb-2">{c.inboxTitle}</h2>
        <p className="text-slate-400 text-sm">
          {c.inboxBody(<strong className="text-white">{email}</strong>)}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 rounded-2xl p-8 text-center">
      <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
        <Zap className="size-6 text-primary" />
      </div>
      <h2 className="text-white font-black text-xl mb-2">
        {c.ctaTitle(failCount)}
      </h2>
      <p className="text-slate-400 text-sm mb-2 max-w-sm mx-auto">
        {c.ctaBody}
      </p>
      <p className="text-slate-500 text-xs mb-6">{c.ctaFinePrint}</p>
      <button
        onClick={handleStart}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-8 py-3 rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60 mx-auto"
      >
        {loading ? c.sending : c.startTrial(email)}
        {!loading && <ChevronRight className="size-4" />}
      </button>
      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      <p className="text-slate-600 text-xs mt-4">
        {c.haveAccount}{' '}
        <a href={`/${lang}/auth/login`} className="text-slate-400 hover:text-white underline transition">{c.signIn}</a>
      </p>
    </div>
  )
}
