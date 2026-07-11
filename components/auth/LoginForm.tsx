'use client'
import { useState } from 'react'
import { useLocale } from 'next-intl'
import { createAuthClient } from '@neondatabase/auth/next'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'

const COPY_EN = {
  checkEmail: 'Check your email',
  sentTo: (email: string) => <>We sent a magic link to <strong>{email}</strong></>,
  continueWithGoogle: 'Continue with Google',
  or: 'or',
  sending: 'Sending…',
  sendMagicLink: 'Send Magic Link',
  emailPlaceholder: 'you@company.com',
  tooManyAttempts: 'Too many attempts. Please wait a few minutes before trying again.',
  googleFailed: 'Could not start Google sign-in. Please try again.',
  magicLinkFailed: 'Could not send the magic link. Please try again.',
}

const COPY_ZH_HK: typeof COPY_EN = {
  checkEmail: '請查看你的電郵',
  sentTo: (email: string) => <>我們已將登入連結發送至 <strong>{email}</strong></>,
  continueWithGoogle: '使用 Google 繼續',
  or: '或',
  sending: '發送中…',
  sendMagicLink: '發送登入連結',
  emailPlaceholder: 'you@company.com',
  tooManyAttempts: '嘗試次數過多，請等待幾分鐘後再試。',
  googleFailed: '無法啟動 Google 登入，請再試一次。',
  magicLinkFailed: '無法發送登入連結，請再試一次。',
}

const authClient = createAuthClient()

export function LoginForm({ next }: { next?: string }) {
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const callbackURL = `${typeof window !== 'undefined' ? window.location.origin : ''}${next ?? '/dashboard'}`

  const signInWithGoogle = async () => {
    setErrorMsg('')
    const { error } = await authClient.signIn.social({ provider: 'google', callbackURL })
    if (error) setErrorMsg(c.googleFailed)
  }

  const signInWithMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    const { error } = await authClient.signIn.magicLink({ email, callbackURL })
    if (error) {
      setErrorMsg(
        error.code === 'TOO_MANY_ATTEMPTS'
          ? c.tooManyAttempts
          : (error.message ?? c.magicLinkFailed)
      )
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-foreground font-medium">{c.checkEmail}</p>
        <p className="text-muted-foreground text-sm mt-1">{c.sentTo(email)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        onClick={signInWithGoogle}
        className="w-full justify-center gap-3"
      >
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
        {c.continueWithGoogle}
      </Button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">{c.or}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={signInWithMagicLink} className="space-y-3">
        <Input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={c.emailPlaceholder}
          required
        />
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? c.sending : c.sendMagicLink}
        </Button>
        {errorMsg && (
          <p className="text-destructive text-sm mt-2">{errorMsg}</p>
        )}
      </form>
    </div>
  )
}
