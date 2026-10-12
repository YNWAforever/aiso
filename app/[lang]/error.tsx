'use client'

import { useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { StatusPage } from '@/components/marketing/StatusPage'

/**
 * Error boundary for every localised route. Renders inside
 * `app/[lang]/layout.tsx`, so the intl provider is available. `digest` is the
 * server-side error id Next attaches; showing it gives support something to
 * search logs for without leaking the message itself.
 */
export default function LocalisedError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const t = useTranslations('errorPage')
  const locale = useLocale()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main id="main" className="flex-1">
      <StatusPage
        code="500"
        eyebrow={t('eyebrow')}
        title={t('title')}
        body={t('body')}
        primary={{ label: t('retry'), onClick: retry }}
        secondary={{ href: `/${locale}`, label: t('home') }}
      >
        {error.digest ? (
          <p className="mt-8 text-xs text-muted-foreground">
            {t('reference')}: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
      </StatusPage>
    </main>
  )
}
