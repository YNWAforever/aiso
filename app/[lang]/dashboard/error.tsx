'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Error boundary for every dashboard page. It wraps the page, not the layout,
 * so the sidebar and top bar stay and the user can retry or go elsewhere.
 * `retry` re-renders the segment (Next 16; see node_modules/next docs).
 */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations('dashboard.states')
  useEffect(() => { console.error(error) }, [error])
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <EmptyState
        illustration="error"
        title={t('errorTitle')}
        description={t('errorBody')}
        action={
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('retry')}
          </button>
        }
      />
    </main>
  )
}
