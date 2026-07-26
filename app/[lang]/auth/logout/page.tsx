'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'

export default function LogoutPage() {
  const router = useRouter()
  const params = useParams<{ lang: string }>()
  const lang = params?.lang ?? 'en'
  const t = useTranslations('auth')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // signOut() resolves { data, error } on an HTTP failure rather than
        // rejecting — better-fetch only throws when built with `throw: true`,
        // and neither Neon Auth nor this client sets it. The error has to be
        // read off the result: redirecting without checking it is the same
        // silent failure supabase-js had, except here it strands a live
        // session cookie behind a page that says the user signed out.
        //
        // An already-signed-out user is not this case. Better Auth's
        // /sign-out is idempotent — it clears the cookie and returns 200 even
        // with no session — so a non-null error is a genuine failure.
        const { error } = await authClient.signOut()
        if (cancelled) return
        if (error) {
          setFailed(true)
          return
        }
        router.replace(`/${lang}/auth/login`)
      } catch {
        // Network-level rejection: the request never reached a response.
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [lang, router])

  return (
    <main className="mx-auto max-w-sm px-6 py-24 text-center">
      {failed ? (
        // Reached only when the session was NOT revoked, so the copy must not
        // imply the user is signed out. A plain <a> back to this page is a
        // full navigation, which re-runs the sign-out attempt.
        <>
          <p className="text-foreground font-medium">{t('sign_out_failed')}</p>
          <a
            href={`/${lang}/auth/logout`}
            className="text-primary underline text-sm mt-2 inline-block"
          >
            {t('try_again')}
          </a>
        </>
      ) : (
        <p className="text-muted-foreground">{t('signing_out')}</p>
      )}
    </main>
  )
}
