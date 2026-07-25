'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { normalizeAuthNext } from '@/lib/auth-navigation'

const COPY_EN = {
  signingIn: 'Signing you in…',
  failed: 'Sign-in could not be completed. Please try again.',
  backToLogin: 'Back to login',
}

const COPY_ZH_HK: typeof COPY_EN = {
  signingIn: '正在為你登入…',
  failed: '登入未能完成，請再試一次。',
  backToLogin: '返回登入頁',
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
  const router = useRouter()
  const ran = useRef(false)
  const [failed, setFailed] = useState(false)
  const c = lang === 'zh-HK' ? COPY_ZH_HK : COPY_EN

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    authClient
      .getSession()
      .then(({ data }) => {
        if (data?.session) {
          router.replace(normalizeAuthNext(lang, next))
        } else {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))
  }, [router, next, lang])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        {failed ? (
          <>
            <p className="text-foreground font-medium">{c.failed}</p>
            <a
              href={`/${lang}/auth/login`}
              className="text-primary underline text-sm mt-2 inline-block"
            >
              {c.backToLogin}
            </a>
          </>
        ) : (
          <p className="text-muted-foreground">{c.signingIn}</p>
        )}
      </div>
    </div>
  )
}
