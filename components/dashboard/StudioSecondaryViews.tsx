'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowUpRight, FileText, Lock, MessageSquare, Unplug } from 'lucide-react'
import { useStudioSession } from '@/components/dashboard/StudioSession'
import type { StudioInspectorReads } from '@/lib/conversation-studio/types'
import type { StudioConnection, StudioOutputs } from '@/lib/conversation-studio/secondary'
import { buildStudioTools } from '@/lib/conversation-studio/navigation'
import type { NavFeatures } from '@/lib/dashboard-nav'

function ViewHeading({ view }: { view: 'threads' | 'documents' | 'connections' | 'tools' }) {
  const t = useTranslations('conversationStudio')
  return <header className="space-y-3"><p className="as-eyebrow">{t(view === 'threads' ? 'threadsTitle' : `nav.${view}`)}</p><h1>{t(`views.${view}.title`)}</h1><p className="as-muted">{t(`views.${view}.description`)}</p></header>
}

export function StudioThreads({ clientId }: { clientId: string }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const router = useRouter()
  const session = useStudioSession()
  const base = `/${lang}/dashboard/${clientId}/studio`
  return <main className="as-page space-y-6"><ViewHeading view="threads" />
    <p className="as-note">{t('privacyBody')}</p>
    <button type="button" className="as-button as-primary px-4" onClick={() => { session.setActiveId(null); session.setNewDraft(''); session.setNewTemplate(null); router.push(base) }}>{t('newThread')}</button>
    {session.threads.length ? <ul className="as-record-list">{session.threads.map(thread => <li key={thread.id}><button className="as-thread flex w-full items-center gap-3 text-left" onClick={() => { session.setActiveId(thread.id); router.push(base) }}>
      <MessageSquare className="size-5 shrink-0 as-blue" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{thread.title}</span><span className="as-muted as-small block truncate">{thread.goal}</span></span><span className="as-badge">{t('privateLabel')}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
    </button></li>)}</ul> : <div className="as-empty space-y-2"><MessageSquare aria-hidden="true" className="as-blue mx-auto" /><h2>{t('recentThreadsEmpty')}</h2><p className="as-muted">{t('views.threads.empty')}</p></div>}
  </main>
}

export function StudioDocuments({ clientId, documents, outputs }: { clientId: string; documents: StudioInspectorReads['documents']; outputs: StudioOutputs | null }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const base = `/${lang}/dashboard/${clientId}`
  return <main className="as-page space-y-6"><ViewHeading view="documents" />
    <section className="space-y-3" aria-labelledby="studio-brand-documents"><div className="as-section-heading"><h2 id="studio-brand-documents">{t('views.documents.inputs')}</h2><Link className="underline" href={`${base}/sources`}>{t('views.documents.sourceFlow')}</Link></div>
      <p className="as-muted as-small">{t('views.documents.readScope')}</p>
      {documents === null ? <p className="as-note">{t('readUnavailable')}</p> : !documents.items.length ? <p className="as-muted">{t('evidence.unknown')}</p> : <ul className="as-record-list">{documents.items.map(doc => <li key={doc.id}><Link className="as-record-link" href={`${base}/sources`}>
        <FileText className="size-5 shrink-0 as-blue" aria-hidden="true" /><span className="min-w-0"><span className="block font-semibold">{doc.label}</span><span className="as-small as-muted block">{t('evidence.approvedVersion', { version: doc.versionNumber })} · {t('views.documents.approvedAt', { date: doc.approvedAt })}</span><span className="as-small as-muted block">{t('views.documents.importedAt', { date: doc.importedAt })}</span></span><ArrowUpRight className="size-4 shrink-0 ml-auto" aria-hidden="true" />
      </Link></li>)}</ul>}
      {documents?.truncated && <p className="as-note">{t('evidence.documentsTruncated')}</p>}
    </section>
    <section className="space-y-3" aria-labelledby="studio-work-outputs"><div className="as-section-heading"><h2 id="studio-work-outputs">{t('views.documents.outputs')}</h2><Link className="underline" href={`${base}/tasks`}>{t('views.documents.outputFlow')}</Link></div>
      {outputs === null ? <p className="as-note">{t('readUnavailable')}</p> : !outputs.items.length ? <p className="as-muted">{t('evidence.unknown')}</p> : <ul className="as-record-list">{outputs.items.map(item => <li key={item.id}><Link className="as-record-link" href={`${base}/work-items/${encodeURIComponent(item.id)}/versions`}>
        <FileText className="size-5 shrink-0 as-blue" aria-hidden="true" /><span className="min-w-0"><span className="block font-semibold">{item.title}</span><span className="as-small as-muted block">{t('views.documents.draftRevision', { revision: item.revision })} · {t('views.documents.updatedAt', { date: item.updatedAt })}</span></span><ArrowUpRight className="size-4 shrink-0 ml-auto" aria-hidden="true" />
      </Link></li>)}</ul>}
      {outputs?.truncated && <p className="as-note">{t('views.documents.outputsTruncated')}</p>}
    </section>
  </main>
}

export function StudioConnections({ clientId, connection }: { clientId: string; connection: StudioConnection }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const state = connection.state
  return <main className="as-page space-y-6"><ViewHeading view="connections" />
    <div className="as-connection-grid">
      <section className="as-card space-y-3" aria-labelledby="studio-gsc-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-gsc-title">{t('connections.searchConsoleTitle')}</h2>
        <p className="as-badge">{t(`sources.${connection.sourceStatus}`)}</p>
        <p>{state ? t(`evidence.sync.${state.kind}`) : t('honesty.pending')}</p>
        {state && 'dataThrough' in state && state.dataThrough && <p className="as-muted as-small">{t('evidence.dataThrough')}: {state.dataThrough}</p>}
        <p className="as-muted">{t('connections.completenessPending')}</p><p className="as-note">{t('connections.savedOnly')}</p>
        <Link href={`/${lang}/dashboard/${clientId}/assets`} className="as-button inline-flex items-center gap-2 px-3">{t('connections.viewScope')}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </section>
      <section className="as-card space-y-3" aria-labelledby="studio-dfs-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-dfs-title">{t('evidence.dataForSeo')}</h2><p className="as-badge as-pending">{t('connections.hkEndpointPending')}</p><p>{t('connections.disconnected')}</p><p className="as-muted">{t('honesty.mentionsCoverage')}</p></section>
      <section className="as-card space-y-3" aria-labelledby="studio-firecrawl-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-firecrawl-title">{t('evidence.firecrawl')}</h2><p className="as-badge">{t('connections.disconnected')}</p><p className="as-muted">{t('connections.firecrawlScope')}</p></section>
    </div>
  </main>
}

export function StudioTools({ clientId, features, admin }: { clientId: string; features: NavFeatures; admin: boolean }) {
  const t = useTranslations('conversationStudio')
  const dashboard = useTranslations('dashboard')
  const lang = useLocale()
  return <main className="as-page space-y-6"><ViewHeading view="tools" /><div className="as-tool-grid">{buildStudioTools({ lang, clientId, features, admin }).map(tool => <Link key={tool.key} href={tool.href} className="as-card as-tool flex items-center gap-3">
    <span className="min-w-0 flex-1 font-semibold">{dashboard(tool.labelKey)}</span>{tool.locked && <Lock className="size-4 shrink-0" aria-label={t('planRequired')} />}{tool.badge && <span className="as-badge">{tool.badge}</span>}<ArrowUpRight className="size-4 shrink-0 as-blue" aria-hidden="true" />
  </Link>)}</div></main>
}
