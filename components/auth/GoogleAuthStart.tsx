'use client'

import { useEffect, useRef, useState } from 'react'
import {
  authClient,
  buildAuthCompleteUrl,
  startGoogleAuthRedirect,
} from '@/lib/auth-client'
import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

export function GoogleAuthStart({ lang, next }: { lang: string; next: string }) {
  const ran = useRef(false)
  const [failed, setFailed] = useState(false)
  const t = lang === 'zh-HK'
    ? createTranslator({ locale: 'zh-HK', messages: zh, namespace: 'authFlow.google' })
    : createTranslator({ locale: 'en', messages: en, namespace: 'authFlow.google' })
  const callbackURL = buildAuthCompleteUrl(lang, next)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    startGoogleAuthRedirect(() =>
      authClient.signIn.social({ provider: 'google', callbackURL }),
    ).then(({ error }) => {
      if (error) setFailed(true)
    })
  }, [callbackURL])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-sm text-center">
        <p
          role={failed ? 'alert' : 'status'}
          aria-live={failed ? 'assertive' : 'polite'}
          className="font-medium text-foreground"
        >
          {failed ? t('failed') : t('starting')}
        </p>
        {failed && (
          <a
            href={`/${lang}/auth/login?next=${encodeURIComponent(next)}`}
            className="mt-3 inline-block text-sm text-primary underline"
          >
            {t('back')}
          </a>
        )}
      </div>
    </main>
  )
}
