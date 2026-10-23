'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import {
  authClient,
  buildAuthCompleteUrl,
  buildGoogleAuthStartUrl,
} from '@/lib/auth-client'
import { buildScanClaimNext } from './ClaimScanOnReturn'
import { trackFunnelEvent } from '@/lib/funnel-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  scanId: string
  lang: string
}

type AccountUnlockContinuation = { mode: 'claim' | 'sign-in'; next: string }

export async function prepareAccountUnlock(scanId: string, lang: string): Promise<AccountUnlockContinuation> {
  const response = await fetch(`/api/scans/${encodeURIComponent(scanId)}/claim-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  })
  const payload: unknown = await response.json().catch(() => null)
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  // A saved report needs sign-in, not a new ownership claim. The result page
  // still checks the authenticated account before exposing its full details.
  if (response.status === 409 && body?.error === 'Scan already belongs to an account') {
    return { mode: 'sign-in', next: `/${lang}/result/${encodeURIComponent(scanId)}` }
  }
  if (!response.ok || body?.ok !== true) throw new Error('claim_intent_failed')
  return { mode: 'claim', next: buildScanClaimNext(lang, scanId) }
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
  const t = useTranslations('accountUnlock')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState<'google' | 'email' | null>(null)
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const [intentState, setIntentState] = useState<'preparing' | 'ready' | 'error'>('preparing')
  const googlePopupRef = useRef<GoogleAuthPopup | null>(null)
  const googlePopupMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const googlePopupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasStartedClaimIntent = useRef(false)
  const [continuation, setContinuation] = useState<AccountUnlockContinuation>({ mode: 'claim', next: buildScanClaimNext(lang, scanId) })
  const next = continuation.next
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

  const prepareClaimIntent = useCallback(async (showPreparing = true) => {
    if (showPreparing) setIntentState('preparing')
    try {
      setContinuation(await prepareAccountUnlock(scanId, lang))
      setIntentState('ready')
    } catch {
      setIntentState('error')
    }
  }, [lang, scanId])

  const startClaimIntentOnMount = useCallback((node: HTMLElement | null) => {
    if (!node || hasStartedClaimIntent.current) return
    hasStartedClaimIntent.current = true
    void prepareClaimIntent(false)
  }, [prepareClaimIntent])

  async function signInWithGoogle() {
    trackFunnelEvent({ name: 'signup_started', locale: lang === 'zh-HK' ? 'zh-HK' : 'en', provider: 'google', scanId })
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
        setStatus(t('googleFailed'))
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
      setStatus(t('googleFailed'))
      setIsError(true)
      setLoading(null)
    }
  }

  async function signInWithMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    trackFunnelEvent({ name: 'signup_started', locale: lang === 'zh-HK' ? 'zh-HK' : 'en', provider: 'magic_link', scanId })
    setLoading('email')
    setStatus('')
    setIsError(false)
    await runAccountUnlockRequest({
      request: () => authClient.signIn.magicLink({ email, callbackURL }),
      onFailure: error => {
        setStatus(error?.code === 'TOO_MANY_ATTEMPTS' ? t('tooManyAttempts') : t('magicLinkFailed'))
        setIsError(true)
      },
      onSuccess: () => setStatus(t('checkEmail')),
      onFinally: () => setLoading(null),
    })
  }

  return (
    <section ref={startClaimIntentOnMount} data-testid="save-report-cta" className="rounded-2xl border-2 border-primary/30 bg-slate-900 p-6 sm:p-8">
      <div className="mx-auto max-w-md text-center">
        <h2 className="text-xl font-black text-white">{continuation.mode === 'sign-in' ? t('savedTitle') : t('title')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{continuation.mode === 'sign-in' ? t('savedBody') : t('body')}</p>

        <Button
          type="button"
          variant="outline"
          onClick={signInWithGoogle}
          disabled={loading !== null || intentState !== 'ready'}
          data-testid="google-signup"
          className="mt-6 h-auto min-h-11 w-full justify-center gap-3 whitespace-normal bg-white py-2.5 text-center leading-snug text-slate-900 hover:bg-slate-100"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" />
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" />
            <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" />
            <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" />
          </svg>
          {continuation.mode === 'sign-in' ? t('savedGoogle') : t('continueGoogle')}
        </Button>

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-white/15" />
          <span className="text-xs text-slate-400">{t('or')}</span>
          <div className="h-px flex-1 bg-white/15" />
        </div>

        <form onSubmit={signInWithMagicLink} className="text-left">
          <label htmlFor="account-unlock-email" className="text-sm font-semibold text-white">
            {t('emailLabel')}
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
            placeholder={t('emailPlaceholder')}
            className="mt-2 border-white/15 bg-white/10 text-white placeholder:text-slate-500"
          />
          <Button
            type="submit"
            disabled={loading !== null || intentState !== 'ready'}
            data-testid="create-account"
            className="mt-3 h-auto min-h-11 w-full whitespace-normal py-2.5 leading-snug"
          >
            {loading === 'email' ? t('sending') : t('createAccount')}
          </Button>
        </form>

        <p
          role="status"
          aria-live="polite"
          className={`mt-3 min-h-5 text-sm ${isError ? 'text-red-300' : 'text-emerald-300'}`}
        >
          {status}
        </p>
        <p className="mt-2 text-xs text-slate-400">{continuation.mode === 'sign-in' ? t('savedNote') : t('finePrint')}</p>
        {intentState === 'preparing' ? <p className="mt-2 text-xs text-slate-400">{t('preparing')}</p> : null}
        {intentState === 'error' ? (
          <div className="mt-2">
            <p className="text-xs text-red-300">{t('intentFailed')}</p>
            <button
              type="button"
              onClick={() => {
                trackFunnelEvent({ name: 'scan_retry_clicked', locale: lang === 'zh-HK' ? 'zh-HK' : 'en', scanId })
                void prepareClaimIntent()
              }}
              className="min-h-11 text-sm font-semibold text-white underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {t('retrySaving')}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
