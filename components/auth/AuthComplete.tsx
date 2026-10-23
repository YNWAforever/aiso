'use client'
import { useEffect, useRef, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { normalizeAuthNext } from '@/lib/auth-navigation'
import { authLocale } from '@/lib/auth-return-to'
import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

function hasCompletedSession(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const { session, user } = data as { session?: unknown; user?: unknown }
  return Boolean(session && typeof session === 'object' && !Array.isArray(session)
    && user && typeof user === 'object' && !Array.isArray(user))
}

/**
 * Completes a Neon Auth sign-in on the client.
 *
 * Magic-link/OAuth completions redirect back from Neon's hosted domain with a
 * `neon_auth_session_verifier` query param. The SDK's client performs the
 * verifier → session-cookie exchange inside `getSession()`: its `onRequest`
 * hook appends the verifier from `window.location` to the
 * `/api/auth/get-session` call, and the proxy route handler sets the session
 * cookie on this domain in the response. (The server-middleware exchange path
 * additionally requires a challenge cookie that the magic-link flow never
 * sets, so this client-side exchange is the reliable completion path.)
 */
export function AuthComplete({ lang, next }: { lang: string; next?: string }) {
  const ran = useRef(false)
  const [failed, setFailed] = useState(false)
  // A lang prop, not the provider: the SDK browser fixture mounts this without one.
  const t = lang === 'zh-HK'
    ? createTranslator({ locale: 'zh-HK', messages: zh, namespace: 'authFlow.complete' })
    : createTranslator({ locale: 'en', messages: en, namespace: 'authFlow.complete' })

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const query = new URLSearchParams(window.location.search)
    if (query.has('neon_auth_session_verifier') && !query.get('neon_auth_session_verifier')) {
      queueMicrotask(() => setFailed(true))
      return
    }
    let responseConfirmed = false
    async function complete() {
      try {
        const { data } = await authClient.getSession({
          fetchOptions: {
            // Observe this exchange before SDK cache/history hooks can throw.
            onResponse: async ({ response }) => {
              if (response.ok) responseConfirmed = hasCompletedSession(await response.clone().json())
            },
          },
        })
        if (!hasCompletedSession(data) && !responseConfirmed) {
          setFailed(true)
          return
        }
      } catch {
        if (!responseConfirmed) {
          setFailed(true)
          return
        }
      }
      try {
        // Read authorization afresh with the exchanged cookie and replace the verifier URL.
        window.location.replace(normalizeAuthNext(lang, next))
      } catch {
        setFailed(true)
      }
    }
    void complete()
  }, [next, lang])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        {failed ? (
          <>
            <p className="text-foreground font-medium">{t('failed')}</p>
            <a
              href={`/${authLocale(lang)}/auth/login?next=${encodeURIComponent(normalizeAuthNext(lang, next))}`}
              className="text-primary underline text-sm mt-2 inline-block"
            >
              {t('backToLogin')}
            </a>
          </>
        ) : (
          <p className="text-muted-foreground">{t('signingIn')}</p>
        )}
      </div>
    </div>
  )
}
