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
        await authClient.signOut()
        if (!cancelled) router.replace(`/${lang}/auth/login`)
      } catch {
        // The session cookie may already be gone. Send the user to login either
        // way rather than stranding them on a blank page.
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [lang, router])

  return (
    <main className="mx-auto max-w-sm px-6 py-24 text-center">
      {failed ? (
        <a href={`/${lang}/auth/login`} className="underline">{t('continue_to_sign_in')}</a>
      ) : (
        <p className="text-muted-foreground">{t('signing_out')}</p>
      )}
    </main>
  )
}
