'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowUpRight, FileText, Lock, MessageSquare, Unplug } from 'lucide-react'
import { useStudioSession, type StudioThread } from '@/components/dashboard/StudioSession'
import { groupThreads, matchesThread, relativeTime } from '@/lib/conversation-studio/thread-list'
import type { StudioInspectorReads } from '@/lib/conversation-studio/types'
import type { StudioConnection, StudioDriveConnection, StudioOutputs } from '@/lib/conversation-studio/secondary'
import type { StudioDfsBrandSettings } from '@/lib/conversation-studio/dfs-query'
import type { StudioFirecrawlBrandSettings } from '@/lib/conversation-studio/firecrawl-query'
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
  const [query, setQuery] = useState('')
  const base = `/${lang}/dashboard/${clientId}/studio`
  // Threads exist only after the client-side read, so "now" is never rendered on the server.
  const now = new Date()
  const skillLabel = (skill: StudioThread['skill']) => skill ? t(`templates.${skill}.label`) : null
  const visible = session.threads.filter(thread => matchesThread(thread, query, skillLabel(thread.skill)))
  return <main className="as-page space-y-6"><ViewHeading view="threads" />
    <p className="as-note">{t('privacyBody')}</p>
    <div className="flex flex-wrap items-end gap-3">
      <button type="button" className="as-button as-primary px-4" onClick={() => { session.setActiveId(null); session.setNewDraft(''); session.setNewTemplate(null); router.push(base) }}>{t('newThread')}</button>
      {session.hydrated && !session.readFailed && session.threads.length > 0 && <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor="studio-thread-search" className="as-muted as-small block font-semibold">{t('threadSearch.label')}</label>
        <input id="studio-thread-search" type="search" value={query} onChange={event => setQuery(event.target.value)} className="as-search block w-full min-w-0" />
      </div>}
    </div>
    {session.readFailed ? <p className="as-note">{t('readUnavailable')}</p> : !session.hydrated ? <p className="as-muted" aria-busy="true">{t('loadingThreads')}</p> : !session.threads.length
      ? <div className="as-empty space-y-2"><MessageSquare aria-hidden="true" className="as-blue mx-auto" /><h2>{t('recentThreadsEmpty')}</h2><p className="as-muted">{t('views.threads.empty')}</p></div>
      : !visible.length ? <p className="as-muted" role="status">{t('threadSearch.noMatch', { query: query.trim() })}</p>
      : groupThreads(visible, now).map(group => <section key={group.key} aria-labelledby={`studio-threads-${group.key}`} className="space-y-2">
        <h2 id={`studio-threads-${group.key}`} className="as-muted as-small font-semibold">{t(`threadGroups.${group.key}`)}</h2>
        <ul className="as-record-list">{group.threads.map(thread => {
          const skill = skillLabel(thread.skill)
          const when = relativeTime(thread.updatedAt, now, lang)
          return <li key={thread.id}><button className="as-thread flex w-full items-center gap-3 text-left" onClick={() => { session.selectThread(thread.id); router.push(base) }}>
            <MessageSquare className="size-5 shrink-0 as-blue" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{thread.title}</span><span className="as-muted as-small block truncate">{thread.goal}</span>{thread.saveState === 'failed' && <span className="as-muted as-small block">{t('saveFailed')}</span>}</span>
            {/* A skill-started thread is titled with the skill; repeating it as a tag adds nothing. */}
            {skill && skill !== thread.title && <span className="as-badge">{skill}</span>}
            {when && <span className="as-muted as-small shrink-0">{when}</span>}
            <span className="as-badge">{t(thread.saveState === 'persisted' ? 'privateLabel' : 'temporaryLabel')}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
          </button></li>
        })}</ul>
      </section>)}
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

function DfsSettings({ clientId, settings }: { clientId: string; settings: StudioDfsBrandSettings }) {
  const t = useTranslations('conversationStudio')
  const [enabled, setEnabled] = useState(settings.enabled)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  async function toggle() {
    if (state === 'saving') return
    setState('saving')
    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/dataforseo/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ enabled: !enabled }),
      })
      if (!response.ok) { setState('error'); return }
      setEnabled(!enabled)
      setState('saved')
    } catch { setState('error') }
  }
  return <section className="as-card space-y-3" aria-labelledby="studio-dfs-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-dfs-title">{t('evidence.dataForSeo')}</h2>
    <p className="as-badge">{t(enabled ? 'connections.dfsEnabled' : 'connections.dfsDisabled')}</p>
    <p className="as-badge as-pending">{t('connections.dfsSerpPending')}</p>
    {!settings.credentialsConfigured && <p className="as-badge">{t('connections.disconnected')}</p>}
    <p className="as-muted">{t('connections.dfsSettingsNote')}</p>
    <button type="button" className="as-button px-3" disabled={state === 'saving'} onClick={toggle}>{t(enabled ? 'connections.dfsDisable' : 'connections.dfsEnable')}</button>
    {state === 'saved' && <p className="as-note">{t('connections.dfsSettingsSaved')}</p>}
    {state === 'error' && <p role="alert" className="as-note">{t('connections.dfsSettingsError')}</p>}
    <p className="as-muted">{t('honesty.mentionsCoverage')}</p>
  </section>
}

function FirecrawlSettings({ clientId, settings }: { clientId: string; settings: StudioFirecrawlBrandSettings }) {
  const t = useTranslations('conversationStudio')
  const [enabled, setEnabled] = useState(settings.enabled)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  async function toggle() {
    if (state === 'saving') return
    setState('saving')
    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/firecrawl/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ enabled: !enabled }),
      })
      if (!response.ok) { setState('error'); return }
      setEnabled(!enabled)
      setState('saved')
    } catch { setState('error') }
  }
  return <section className="as-card space-y-3" aria-labelledby="studio-firecrawl-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-firecrawl-title">{t('evidence.firecrawl')}</h2>
    <p className="as-badge">{t(enabled ? 'connections.firecrawlEnabled' : 'connections.firecrawlDisabled')}</p>
    {!settings.keyConfigured && <p className="as-badge">{t('connections.disconnected')}</p>}
    <p className="as-muted">{t('connections.firecrawlSettingsNote')}</p>
    <button type="button" className="as-button px-3" disabled={state === 'saving'} onClick={toggle}>{t(enabled ? 'connections.firecrawlDisable' : 'connections.firecrawlEnable')}</button>
    {state === 'saved' && <p className="as-note">{t('connections.firecrawlSettingsSaved')}</p>}
    {state === 'error' && <p role="alert" className="as-note">{t('connections.firecrawlSettingsError')}</p>}
  </section>
}

export type StudioDriveNotice = 'connected' | 'failed' | 'scope'

/** The member's own Drive for the act/edit path. Connecting is their own account, not a vendor purchase. */
function DriveConnectionCard({ clientId, drive, notice }: { clientId: string; drive: StudioDriveConnection; notice?: StudioDriveNotice }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const [status, setStatus] = useState(drive.status)
  const [state, setState] = useState<'idle' | 'saving' | 'error' | 'removeInGoogle'>('idle')
  const returnPath = `/${lang}/dashboard/${clientId}/studio/connections`
  const connectHref = `/api/integrations/google/drive/start?return=${encodeURIComponent(returnPath)}`
  async function disconnect() {
    if (state === 'saving') return
    setState('saving')
    try {
      const response = await fetch('/api/account/integrations/google-drive', { method: 'DELETE', cache: 'no-store' })
      const data = await response.json().catch(() => null) as { googleRevoked?: boolean } | null
      if (!response.ok) { setState('error'); return }
      setStatus('disconnected')
      setState(data?.googleRevoked === false ? 'removeInGoogle' : 'idle')
    } catch { setState('error') }
  }
  return <section className="as-card space-y-3" aria-labelledby="studio-drive-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-drive-title">{t('connections.driveTitle')}</h2>
    {notice === 'connected' && <p role="status" className="as-note">{t('connections.driveNoticeConnected')}</p>}
    {(notice === 'failed' || notice === 'scope') && <p role="alert" className="as-note">{t(notice === 'scope' ? 'connections.driveNoticeScope' : 'connections.driveNoticeFailed')}</p>}
    <p className="as-badge">{status === 'active'
      ? (drive.googleEmail ? t('connections.driveConnectedAs', { email: drive.googleEmail }) : t('connections.driveConnected'))
      : status === 'needs_reconnect' ? t('connections.driveReconnectNeeded') : t('connections.disconnected')}</p>
    <p className="as-muted">{t('connections.driveScope')}</p>
    {status === 'active'
      ? <button type="button" className="as-button px-3" disabled={state === 'saving'} onClick={disconnect}>{t('connections.driveDisconnect')}</button>
      : <a href={connectHref} className="as-button inline-flex items-center gap-2 px-3">{t(status === 'needs_reconnect' ? 'connections.driveReconnect' : 'connections.driveConnect')}</a>}
    {state === 'error' && <p role="alert" className="as-note">{t('connections.driveDisconnectError')}</p>}
    {state === 'removeInGoogle' && <p role="status" className="as-note">{t('connections.driveRemoveInGoogle')}</p>}
  </section>
}

export function StudioConnections({ clientId, connection, driveNotice }: { clientId: string; connection: StudioConnection; driveNotice?: StudioDriveNotice }) {
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
      {connection.dfs
        ? <DfsSettings clientId={clientId} settings={connection.dfs} />
        : <section className="as-card space-y-3" aria-labelledby="studio-dfs-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-dfs-title">{t('evidence.dataForSeo')}</h2><p className="as-badge as-pending">{t('connections.hkEndpointPending')}</p><p>{t('connections.disconnected')}</p><p className="as-muted">{t('honesty.mentionsCoverage')}</p></section>}
      {connection.firecrawl
        ? <FirecrawlSettings clientId={clientId} settings={connection.firecrawl} />
        : <section className="as-card space-y-3" aria-labelledby="studio-firecrawl-title"><Unplug className="size-5 as-blue" aria-hidden="true" /><h2 id="studio-firecrawl-title">{t('evidence.firecrawl')}</h2><p className="as-badge">{t('connections.disconnected')}</p><p className="as-muted">{t('connections.firecrawlScope')}</p></section>}
      {connection.drive && <DriveConnectionCard clientId={clientId} drive={connection.drive} notice={driveNotice} />}
    </div>
  </main>
}

export function StudioTools({ clientId, features, admin }: { clientId: string; features: NavFeatures; admin: boolean }) {
  const t = useTranslations('conversationStudio')
  const dashboard = useTranslations('dashboard')
  const lang = useLocale()
  return <main className="as-page space-y-6"><ViewHeading view="tools" /><div className="as-tool-grid">{buildStudioTools({ lang, clientId, features, admin, conversationStudio: true }).map(tool => <Link key={tool.key} href={tool.href} className="as-card as-tool flex items-center gap-3">
    <span className="min-w-0 flex-1 font-semibold">{dashboard(tool.labelKey)}</span>{tool.locked && <Lock className="size-4 shrink-0" aria-label={t('planRequired')} />}{tool.badge && <span className="as-badge">{tool.badge}</span>}<ArrowUpRight className="size-4 shrink-0 as-blue" aria-hidden="true" />
  </Link>)}</div></main>
}
