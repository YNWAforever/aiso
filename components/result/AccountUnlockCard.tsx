'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  authClient,
  buildAuthCompleteUrl,
  buildGoogleAuthStartUrl,
} from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const COPY_EN = {
  title: 'Save your scan and unlock the full report',
  body: 'Create a free account to view all checks, private remediation details, and your Fix Pack.',
  emailLabel: 'Work email',
  emailPlaceholder: 'you@company.com',
  createAccount: 'Create Free Account',
  continueGoogle: 'Continue with Google',
  or: 'or',
  sending: 'Sending magic link…',
  checkEmail: 'Check your inbox for your secure sign-in link.',
  tooManyAttempts: 'Too many attempts. Please wait a few minutes before trying again.',
  googleFailed: 'Could not start Google sign-in. Please try again.',
  magicLinkFailed: 'Could not send the magic link. Please try again.',
  finePrint: 'No credit card · Your scan will be saved automatically.',
}

const COPY_ZH_HK: typeof COPY_EN = {
  title: '儲存掃描並解鎖完整報告',
  body: '免費建立帳戶，即可查看全部檢查、私人修復詳情及你的 Fix Pack。',
  emailLabel: '工作電郵',
  emailPlaceholder: 'you@company.com',
  createAccount: '免費建立帳戶',
  continueGoogle: '使用 Google 繼續',
  or: '或',
  sending: '正在發送登入連結…',
  checkEmail: '請查看收件箱內的安全登入連結。',
  tooManyAttempts: '嘗試次數過多，請等待幾分鐘後再試。',
  googleFailed: '無法啟動 Google 登入，請再試一次。',
  magicLinkFailed: '無法發送登入連結，請再試一次。',
  finePrint: '毋須信用卡 · 你的掃描會自動儲存。',
}

type Props = {
  scanId: string
  lang: string
}

type AuthRequestError = { code?: string; message?: string }

type AuthRequestOptions = {
  request: () => Promise<{ error?: AuthRequestError | null }>
  onFailure: (error?: AuthRequestError) => void
  onSuccess: () => void
  onFinally: () => void
}

type GoogleAuthPopup = {
  opener: unknown
  readonly closed: boolean
  focus: () => void
  close?: () => void
}

type GoogleAccountUnlockOptions = {
  embedded: boolean
  bridgeURL: string
  activePopup?: GoogleAuthPopup | null
  openWindow: (url: string, target: string) => GoogleAuthPopup | null
  request: () => Promise<{ error?: AuthRequestError | null }>
}

export async function launchGoogleAccountUnlock({
  embedded,
  bridgeURL,
  activePopup,
  openWindow,
  request,
}: GoogleAccountUnlockOptions): Promise<{
  error?: AuthRequestError | null
  popup?: GoogleAuthPopup
}> {
  if (!embedded) return request()

  if (activePopup && !activePopup.closed) {
    try {
      activePopup.focus()
    } catch {}
    return { error: null, popup: activePopup }
  }

  const popup = openWindow(bridgeURL, 'fimmick-google-auth')
  if (!popup) return { error: { code: 'POPUP_BLOCKED' } }

  try {
    popup.opener = null
  } catch {
    try {
      popup.close?.()
    } catch {}
    return { error: { code: 'OPENER_ISOLATION_FAILED' } }
  }
  return { error: null, popup }
}

export async function runAccountUnlockRequest({
  request,
  onFailure,
  onSuccess,
  onFinally,
}: AuthRequestOptions) {
  try {
    const { error } = await request()
    if (error) onFailure(error)
    else onSuccess()
  } catch {
    onFailure(undefined)
  } finally {
    onFinally()
  }
}

export function AccountUnlockCard({ scanId, lang }: Props) {
  const c = lang === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState<'google' | 'email' | null>(null)
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const googlePopupRef = useRef<GoogleAuthPopup | null>(null)
  const googlePopupMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const googlePopupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const next = `/${lang}/onboarding?scan=${encodeURIComponent(scanId)}`
  const callbackURL = buildAuthCompleteUrl(lang, next)

  function releaseGooglePopup() {
    if (googlePopupMonitorRef.current) clearInterval(googlePopupMonitorRef.current)
    if (googlePopupTimeoutRef.current) clearTimeout(googlePopupTimeoutRef.current)
    googlePopupMonitorRef.current = null
    googlePopupTimeoutRef.current = null
    googlePopupRef.current = null
    setLoading(null)
  }

  useEffect(() => () => {
    if (googlePopupMonitorRef.current) clearInterval(googlePopupMonitorRef.current)
    if (googlePopupTimeoutRef.current) clearTimeout(googlePopupTimeoutRef.current)
  }, [])

  async function signInWithGoogle() {
    setLoading('google')
    setStatus('')
    setIsError(false)

    try {
      const result = await launchGoogleAccountUnlock({
        embedded: (() => {
          try {
            return window.self !== window.top
          } catch {
            return true
          }
        })(),
        bridgeURL: buildGoogleAuthStartUrl(lang, next),
        activePopup: googlePopupRef.current,
        openWindow: (url, target) => window.open(url, target),
        request: () => authClient.signIn.social({ provider: 'google', callbackURL }),
      })

      if (result.error) {
        setStatus(c.googleFailed)
        setIsError(true)
        setLoading(null)
        return
      }

      if (result.popup) {
        googlePopupRef.current = result.popup
        if (!googlePopupMonitorRef.current) {
          googlePopupMonitorRef.current = setInterval(() => {
            if (googlePopupRef.current?.closed) releaseGooglePopup()
          }, 500)
          googlePopupTimeoutRef.current = setTimeout(releaseGooglePopup, 120_000)
        }
        return
      }

      setLoading(null)
    } catch {
      setStatus(c.googleFailed)
      setIsError(true)
      setLoading(null)
    }
  }

  async function signInWithMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading('email')
    setStatus('')
    setIsError(false)
    await runAccountUnlockRequest({
      request: () => authClient.signIn.magicLink({ email, callbackURL }),
      onFailure: error => {
        setStatus(error?.code === 'TOO_MANY_ATTEMPTS' ? c.tooManyAttempts : c.magicLinkFailed)
        setIsError(true)
      },
      onSuccess: () => setStatus(c.checkEmail),
      onFinally: () => setLoading(null),
    })
  }

  return (
    <section className="rounded-2xl border-2 border-primary/30 bg-slate-900 p-6 sm:p-8">
      <div className="mx-auto max-w-md text-center">
        <h2 className="text-xl font-black text-white">{c.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{c.body}</p>

        <Button
          type="button"
          variant="outline"
          onClick={signInWithGoogle}
          disabled={loading !== null}
          data-testid="google-signup"
          className="mt-6 w-full justify-center gap-3 bg-white text-slate-900 hover:bg-slate-100"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" />
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" />
            <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" />
            <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" />
          </svg>
          {c.continueGoogle}
        </Button>

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-white/15" />
          <span className="text-xs text-slate-400">{c.or}</span>
          <div className="h-px flex-1 bg-white/15" />
        </div>

        <form onSubmit={signInWithMagicLink} className="text-left">
          <label htmlFor="account-unlock-email" className="text-sm font-semibold text-white">
            {c.emailLabel}
          </label>
          <Input
            id="account-unlock-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder={c.emailPlaceholder}
            className="mt-2 border-white/15 bg-white/10 text-white placeholder:text-slate-500"
          />
          <Button
            type="submit"
            disabled={loading !== null}
            data-testid="create-account"
            className="mt-3 w-full"
          >
            {loading === 'email' ? c.sending : c.createAccount}
          </Button>
        </form>

        <p
          role="status"
          aria-live="polite"
          className={`mt-3 min-h-5 text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}
        >
          {status}
        </p>
        <p className="mt-2 text-xs text-slate-400">{c.finePrint}</p>
      </div>
    </section>
  )
}
