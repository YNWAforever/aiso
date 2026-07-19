'use client'

import { useEffect, useRef, useState } from 'react'
import {
  authClient,
  buildAuthCompleteUrl,
  startGoogleAuthRedirect,
} from '@/lib/auth-client'

const COPY_EN = {
  starting: 'Opening Google sign-in…',
  failed: 'Could not start Google sign-in in this window.',
  back: 'Back to sign in',
}

const COPY_ZH_HK: typeof COPY_EN = {
  starting: '正在開啟 Google 登入…',
  failed: '未能在此視窗開啟 Google 登入。',
  back: '返回登入',
}

export function GoogleAuthStart({ lang, next }: { lang: string; next: string }) {
  const ran = useRef(false)
  const [failed, setFailed] = useState(false)
  const copy = lang === 'zh-HK' ? COPY_ZH_HK : COPY_EN
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
          {failed ? copy.failed : copy.starting}
        </p>
        {failed && (
          <a
            href={`/${lang}/auth/login?next=${encodeURIComponent(next)}`}
            className="mt-3 inline-block text-sm text-primary underline"
          >
            {copy.back}
          </a>
        )}
      </div>
    </main>
  )
}
