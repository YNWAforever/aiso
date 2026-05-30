'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Zap, ChevronRight, Mail } from 'lucide-react'

interface Props {
  email: string        // pre-filled from email gate
  scanId: string
  lang: string
  failCount: number
}

export function TrialCta({ email, scanId, lang, failCount }: Props) {
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
        <h2 className="text-white font-black text-xl mb-2">Check your inbox</h2>
        <p className="text-slate-400 text-sm">
          We sent a magic link to <strong className="text-white">{email}</strong>.
          Click it to start your free trial and get your Fix Pack.
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
        Fix your {failCount} issue{failCount !== 1 ? 's' : ''} — free for 7 days
      </h2>
      <p className="text-slate-400 text-sm mb-2 max-w-sm mx-auto">
        Start your free trial to download your Fix Pack: llms.txt, robots.txt patch, and FAQ schema — ready to deploy.
      </p>
      <p className="text-slate-500 text-xs mb-6">No credit card required · 7-day trial · Cancel anytime</p>
      <button
        onClick={handleStart}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-8 py-3 rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60 mx-auto"
      >
        {loading ? 'Sending magic link…' : `Start free trial — send to ${email}`}
        {!loading && <ChevronRight className="size-4" />}
      </button>
      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      <p className="text-slate-600 text-xs mt-4">
        Already have an account?{' '}
        <a href={`/${lang}/auth/login`} className="text-slate-400 hover:text-white underline transition">Sign in</a>
      </p>
    </div>
  )
}
