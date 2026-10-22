'use client'
import { useTranslations } from 'next-intl'

type AgentSectionProps = { status: string | null | undefined; children: React.ReactNode; hasOutput?:boolean; draftNotice?:string }
export function AgentSection({ status, children,hasOutput=false,draftNotice }: AgentSectionProps) {
  const t = useTranslations('generatedWork')
  if (status !== 'complete'&&!hasOutput) {
    const state = status === 'pending' || status === 'running' || status === 'error' ? status : 'unavailable'
    return <section className="rounded-xl border border-dash-border bg-dash-surface p-5" aria-label={t('title')}>
      <h2 className="text-sm font-semibold text-dash-text">{t('title')}</h2>
      <p role="status" className="mt-3 text-sm text-dash-muted">{t(state)}</p>
    </section>
  }
  return <section className="space-y-3" aria-label={t('title')}>
    <h2 className="text-sm font-semibold text-dash-text">{t('title')}</h2>
    {status!=='complete'?<p role="status" className="text-sm text-dash-muted">{t(status==='pending'?'pendingWithOutput':status==='running'?'runningWithOutput':status==='error'?'errorWithOutput':'availableOutput')}</p>:null}
    <p className="text-sm text-dash-muted">{draftNotice??t('draftNotice')}</p>
    {children}
  </section>
}
