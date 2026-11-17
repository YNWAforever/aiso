'use client'
import { useTranslations } from 'next-intl'

type AgentSectionProps = { status: string | null | undefined; children: React.ReactNode; hasOutput?:boolean; draftNotice?:string }
export function AgentSection({ status, children,hasOutput=false,draftNotice }: AgentSectionProps) {
  const t = useTranslations('generatedWork')
  if (status !== 'complete'&&!hasOutput) {
    const state = status === 'pending' || status === 'running' || status === 'error' ? status : 'unavailable'
    return <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="generated-work-heading">
      <h2 id="generated-work-heading" className="text-lg font-bold text-foreground">{t('title')}</h2>
      <p role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(state)}</p>
    </section>
  }
  return <section className="space-y-4" aria-labelledby="generated-work-heading">
    <h2 id="generated-work-heading" className="text-lg font-bold text-foreground">{t('title')}</h2>
    {status!=='complete'?<p role="status" className="text-sm leading-relaxed text-muted-foreground">{t(status==='pending'?'pendingWithOutput':status==='running'?'runningWithOutput':status==='error'?'errorWithOutput':'availableOutput')}</p>:null}
    <p className="text-sm leading-relaxed text-muted-foreground">{draftNotice??t('draftNotice')}</p>
    {children}
  </section>
}
