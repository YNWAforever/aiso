'use client'
import { useTranslations } from 'next-intl'

type AgentSectionProps = { status: string | null | undefined; children: React.ReactNode }
export function AgentSection({ status, children }: AgentSectionProps) {
  const t = useTranslations('generatedWork')
  if (status !== 'complete') {
    const state = status === 'pending' || status === 'running' || status === 'error' ? status : 'unavailable'
    return <section className="rounded-xl border border-dash-border bg-dash-surface p-5" aria-label={t('title')}>
      <h2 className="text-sm font-semibold text-dash-text">{t('title')}</h2>
      <p role="status" className="mt-3 text-sm text-dash-muted">{t(state)}</p>
    </section>
  }
  return <section className="space-y-3" aria-label={t('title')}>
    <h2 className="text-sm font-semibold text-dash-text">{t('title')}</h2>
    <p className="text-sm text-dash-muted">{t('draftNotice')}</p>
    {children}
  </section>
}
