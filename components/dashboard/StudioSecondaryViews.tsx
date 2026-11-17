'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowUpRight, Ellipsis, FileText, Lock, MessageSquare } from 'lucide-react'
import { useStudioSession, type StudioThread } from '@/components/dashboard/StudioSession'
import { groupThreads, matchesThread, relativeTime } from '@/lib/conversation-studio/thread-list'
import type { StudioInspectorReads } from '@/lib/conversation-studio/types'
import type { StudioConnection, StudioDriveConnection, StudioOutputs } from '@/lib/conversation-studio/secondary'
import type { StudioDfsBrandSettings } from '@/lib/conversation-studio/dfs-query'
import type { StudioFirecrawlBrandSettings } from '@/lib/conversation-studio/firecrawl-query'
import { buildStudioTools } from '@/lib/conversation-studio/navigation'
import { gscConnectionStatus, type ConnectionTone } from '@/lib/conversation-studio/connection-view'
import { studioSkill } from '@/lib/conversation-studio/skills'
import { StudioConnectAssistant } from '@/components/dashboard/StudioConnectAssistant'
import { StudioSectionHeader } from '@/components/dashboard/StudioSectionHeader'
import type { NavFeatures } from '@/lib/dashboard-nav'

export function StudioThreads({ clientId, showTabs = false }: { clientId: string; showTabs?: boolean }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const router = useRouter()
  const session = useStudioSession()
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [actionFailed, setActionFailed] = useState(false)
  const base = `/${lang}/dashboard/${clientId}/studio`
  // Threads exist only after the client-side read, so "now" is never rendered on the server.
  const now = new Date()
  const skillLabel = (skill: StudioThread['skill']) => {
    // Threads persist the registry id (109); the card copy stays the home-task label.
    const task = skill ? studioSkill(skill)?.task : null
    return task ? t(`templates.${task}.label`) : null
  }
  const visible = session.threads.filter(thread => matchesThread(thread, query, skillLabel(thread.skill)))
  async function act(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean; visibility?: 'private' | 'shared' }) {
    setActionFailed(false)
    const result = await session.updateThread(id, patch)
    if (!result.ok) setActionFailed(true)
    return result.ok
  }
  function startRename(thread: StudioThread) { setRenamingId(thread.id); setRenameDraft(thread.title); setActionFailed(false) }
  async function saveRename(id: string) {
    const title = renameDraft.trim()
    if (!title) return
    if (await act(id, { title })) setRenamingId(null)
  }
  const closeMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const details = event.currentTarget.closest('details')
    details?.removeAttribute('open')
    // Do not leave focus on a hidden menu item after the action runs.
    const summary = details?.querySelector('summary')
    if (summary instanceof HTMLElement) summary.focus()
  }
  return <main className="as-page space-y-6"><StudioSectionHeader clientId={clientId} active="threads" showTabs={showTabs} title={t('threadsTitle')} description={t('views.threads.description')} />
    <div className="flex flex-wrap items-end gap-3">
      <button type="button" className="as-button as-primary px-4" onClick={() => { session.setActiveId(null); session.setNewDraft(''); session.setNewTemplate(null); router.push(base) }}>{t('newThread')}</button>
      {session.hydrated && !session.readFailed && session.threads.length > 0 && <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor="studio-thread-search" className="as-muted as-small block font-semibold">{t('threadSearch.label')}</label>
        <input id="studio-thread-search" type="search" value={query} onChange={event => setQuery(event.target.value)} className="as-search block w-full min-w-0" />
      </div>}
    </div>
    {session.hydrated && !session.readFailed && session.threads.length > 0 && <p className="as-small as-muted">{query.trim() ? t('threadSearch.resultCount', { count: visible.length }) : t('threadsCount', { count: session.threads.length })}</p>}
    {actionFailed && <p role="alert" className="as-note">{t('threadActions.failed')}</p>}
    {session.readFailed ? <p className="as-note">{t('readUnavailable')}</p> : !session.hydrated ? <p className="as-muted" aria-busy="true">{t('loadingThreads')}</p> : !session.threads.length
      ? <div className="as-empty space-y-2"><MessageSquare aria-hidden="true" className="as-blue mx-auto" /><h2>{t('recentThreadsEmpty')}</h2><p className="as-muted">{t('views.threads.empty')}</p></div>
      : !visible.length ? <p className="as-muted" role="status">{t('threadSearch.noMatch', { query: query.trim() })}</p>
      : groupThreads(visible, now).map(group => <section key={group.key} aria-labelledby={`studio-threads-${group.key}`} className="space-y-2">
        <h2 id={`studio-threads-${group.key}`} className="as-muted as-small font-semibold">{t(`threadGroups.${group.key}`)}</h2>
        <ul className="as-record-list">{group.threads.map(thread => {
          const skill = skillLabel(thread.skill)
          const when = relativeTime(thread.updatedAt, now, lang)
          return <li key={thread.id}>
            <div className="flex flex-wrap items-start gap-2">
              <button className="as-thread flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { session.selectThread(thread.id); router.push(`${base}?thread=${encodeURIComponent(thread.id)}`) }}>
                <MessageSquare className="size-5 shrink-0 as-blue" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{thread.title}</span><span className="as-muted as-small block truncate">{thread.goal}</span>{thread.saveState === 'failed' && <span className="as-muted as-small block">{t('saveFailed')}</span>}</span>
                {/* A skill-started thread is titled with the skill; repeating it as a tag adds nothing. */}
                {skill && skill !== thread.title && <span className="as-badge">{skill}</span>}
                {thread.pinned && <span className="as-badge">{t('pinnedLabel')}</span>}
                {when && <span className="as-muted as-small shrink-0">{when}</span>}
                {thread.saveState === 'unsaved' && <span className="as-badge">{t('temporaryLabel')}</span>}
                {thread.visibility === 'shared' && <span className="as-badge">{t('sharedLabel')}</span>}
                <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
              </button>
              {thread.mine
                ? <details className="relative shrink-0">
                  <summary aria-label={t('threadActions.menu', { title: thread.title })} className="as-button inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center px-2 text-sm [&::-webkit-details-marker]:hidden"><Ellipsis className="size-4" aria-hidden="true" /></summary>
                  <div className="absolute right-0 top-full z-20 mt-1 w-48 space-y-1 rounded-lg border border-border bg-background p-1 shadow-e2">
                    <button type="button" className="as-button flex min-h-11 w-full items-center justify-start px-3 text-left text-sm" aria-pressed={thread.pinned} onClick={event => { closeMenu(event); void act(thread.id, { pinned: !thread.pinned }) }}>{t(thread.pinned ? 'threadActions.unpin' : 'threadActions.pin')}</button>
                    <button type="button" className="as-button flex min-h-11 w-full items-center justify-start px-3 text-left text-sm" aria-pressed={thread.visibility === 'shared'} onClick={event => { closeMenu(event); void act(thread.id, { visibility: thread.visibility === 'shared' ? 'private' : 'shared' }) }}>{t(thread.visibility === 'shared' ? 'threadActions.unshare' : 'threadActions.share')}</button>
                    <button type="button" className="as-button flex min-h-11 w-full items-center justify-start px-3 text-left text-sm" onClick={event => { closeMenu(event); startRename(thread) }}>{t('threadActions.rename')}</button>
                    <button type="button" className="as-button flex min-h-11 w-full items-center justify-start px-3 text-left text-sm" onClick={event => { closeMenu(event); void act(thread.id, { archived: true }) }}>{t('threadActions.archive')}</button>
                  </div>
                </details>
                : null}
            </div>
            {renamingId === thread.id && <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void saveRename(thread.id) }}>
              <label className="min-w-0 flex-1 space-y-1 text-sm"><span className="as-muted as-small block font-semibold">{t('threadActions.rename')}</span>
                <input className="as-search block w-full min-w-0" value={renameDraft} maxLength={200} onChange={event => setRenameDraft(event.target.value)} autoFocus />
              </label>
              <button type="submit" className="as-button as-primary inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-sm" disabled={!renameDraft.trim()}>{t('threadActions.save')}</button>
              <button type="button" className="as-button inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-sm" onClick={() => setRenamingId(null)}>{t('threadActions.cancel')}</button>
            </form>}
          </li>
        })}</ul>
      </section>)}
  </main>
}

export function StudioDocuments({ clientId, documents, outputs, showTabs = false }: { clientId: string; documents: StudioInspectorReads['documents']; outputs: StudioOutputs | null; showTabs?: boolean }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const base = `/${lang}/dashboard/${clientId}`
  return <main className="as-page space-y-6"><StudioSectionHeader clientId={clientId} active="documents" showTabs={showTabs} title={t('nav.documents')} description={t('views.documents.description')} />
    <section className="space-y-3" aria-labelledby="studio-brand-documents"><div className="as-section-heading"><div className="flex flex-wrap items-baseline gap-2"><h2 id="studio-brand-documents">{t('views.documents.inputs')}</h2>{documents && <span className="as-small as-muted">{t('views.documents.inputCount', { count: documents.items.length })}</span>}</div><Link className="underline" href={`${base}/sources`}>{t('views.documents.sourceFlow')}</Link></div>
      <p className="as-muted as-small">{t('views.documents.readScope')}</p>
      {documents === null ? <p className="as-note">{t('readUnavailable')}</p> : !documents.items.length ? <p className="as-muted">{t('views.documents.emptyInputs')}</p> : <ul className="as-record-list">{documents.items.map(doc => <li key={doc.id}><Link className="as-record-link" href={`${base}/sources`}>
        <FileText className="size-5 shrink-0 as-blue" aria-hidden="true" /><span className="min-w-0"><span className="block font-semibold">{doc.label}</span><span className="as-small as-muted block">{t('evidence.approvedVersion', { version: doc.versionNumber })} · {t('views.documents.approvedAt', { date: doc.approvedAt })}</span><span className="as-small as-muted block">{t('views.documents.importedAt', { date: doc.importedAt })}</span></span><ArrowUpRight className="size-4 shrink-0 ml-auto" aria-hidden="true" />
      </Link></li>)}</ul>}
      {documents?.truncated && <p className="as-note">{t('evidence.documentsTruncated')}</p>}
    </section>
    <section className="space-y-3" aria-labelledby="studio-work-outputs"><div className="as-section-heading"><div className="flex flex-wrap items-baseline gap-2"><h2 id="studio-work-outputs">{t('views.documents.outputs')}</h2>{outputs && <span className="as-small as-muted">{t('views.documents.outputCount', { count: outputs.items.length })}</span>}</div><Link className="underline" href={`${base}/tasks`}>{t('views.documents.outputFlow')}</Link></div>
      {outputs === null ? <p className="as-note">{t('readUnavailable')}</p> : !outputs.items.length ? <p className="as-muted">{t('views.documents.emptyOutputs')}</p> : <ul className="as-record-list">{outputs.items.map(item => <li key={item.id}><Link className="as-record-link" href={`${base}/work-items/${encodeURIComponent(item.id)}/versions`}>
        <FileText className="size-5 shrink-0 as-blue" aria-hidden="true" /><span className="min-w-0"><span className="block font-semibold">{item.title}</span><span className="as-small as-muted block">{t('views.documents.draftRevision', { revision: item.revision })} · {t('views.documents.updatedAt', { date: item.updatedAt })}</span></span><ArrowUpRight className="size-4 shrink-0 ml-auto" aria-hidden="true" />
      </Link></li>)}</ul>}
      {outputs?.truncated && <p className="as-note">{t('views.documents.outputsTruncated')}</p>}
    </section>
  </main>
}

function ConnectionRow({ id, title, status, tone, tag, action, children }: {
  id: string
  title: string
  status: string
  tone: ConnectionTone
  tag?: string
  action?: ReactNode
  children?: ReactNode
}) {
  return <li className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="font-semibold">{title}</h2>
        <span className={tone === 'ok' ? 'as-badge as-badge-blue' : tone === 'neutral' ? 'as-badge' : 'as-badge as-badge-amber'}>{status}</span>
        {tag && <span className="as-badge">{tag}</span>}
      </div>
      {children}
    </div>
    {action && <div className="flex flex-wrap gap-2 sm:justify-end">{action}</div>}
  </li>
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
  return <ConnectionRow id="studio-dfs-title" title={t('evidence.dataForSeo')} status={t(!settings.credentialsConfigured ? 'connections.notConfigured' : enabled ? 'connections.dfsEnabled' : 'connections.dfsDisabled')} tone={settings.credentialsConfigured && enabled ? 'ok' : 'neutral'} tag={t('connections.planned')}
    action={<button type="button" className="as-button px-3" disabled={state === 'saving'} onClick={toggle}>{t(enabled ? 'connections.dfsDisable' : 'connections.dfsEnable')}</button>}>
    <p className="as-small as-muted">{t('connections.dfsSettingsNote')}</p>
    <p className="as-small as-muted">{t('connections.dfsSerpPending')}</p>
    <p className="as-small as-muted">{t('honesty.mentionsCoverage')}</p>
    {state === 'saved' && <p className="as-note">{t('connections.dfsSettingsSaved')}</p>}
    {state === 'error' && <p role="alert" className="as-note">{t('connections.dfsSettingsError')}</p>}
  </ConnectionRow>
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
  return <ConnectionRow id="studio-firecrawl-title" title={t('evidence.firecrawl')} status={t(!settings.keyConfigured ? 'connections.notConfigured' : enabled ? 'connections.firecrawlEnabled' : 'connections.firecrawlDisabled')} tone={settings.keyConfigured && enabled ? 'ok' : 'neutral'}
    action={<button type="button" className="as-button px-3" disabled={state === 'saving'} onClick={toggle}>{t(enabled ? 'connections.firecrawlDisable' : 'connections.firecrawlEnable')}</button>}>
    <p className="as-small as-muted">{t('connections.firecrawlSettingsNote')}</p>
    {state === 'saved' && <p className="as-note">{t('connections.firecrawlSettingsSaved')}</p>}
    {state === 'error' && <p role="alert" className="as-note">{t('connections.firecrawlSettingsError')}</p>}
  </ConnectionRow>
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
  const action = status === 'active'
    ? <button type="button" className="as-button px-3" disabled={state === 'saving'} onClick={disconnect}>{t('connections.driveDisconnect')}</button>
    : <a href={connectHref} className="as-button inline-flex items-center gap-2 px-3">{t(status === 'needs_reconnect' ? 'connections.driveReconnect' : 'connections.driveConnect')}</a>
  return <ConnectionRow id="studio-drive-title" title={t('connections.driveTitle')} status={status === 'active' ? t('connections.driveConnected') : status === 'needs_reconnect' ? t('connections.driveReconnectNeeded') : t('connections.disconnected')} tone={status === 'active' ? 'ok' : status === 'needs_reconnect' ? 'pending' : 'neutral'} action={action}>
    {notice === 'connected' && <p role="status" className="as-note">{t('connections.driveNoticeConnected')}</p>}
    {(notice === 'failed' || notice === 'scope') && <p role="alert" className="as-note">{t(notice === 'scope' ? 'connections.driveNoticeScope' : 'connections.driveNoticeFailed')}</p>}
    {status === 'active' && drive.googleEmail && <p className="as-small as-muted">{t('connections.driveConnectedAs', { email: drive.googleEmail })}</p>}
    <p className="as-small as-muted">{t('connections.driveScope')}</p>
    {state === 'error' && <p role="alert" className="as-note">{t('connections.driveDisconnectError')}</p>}
    {state === 'removeInGoogle' && <p role="status" className="as-note">{t('connections.driveRemoveInGoogle')}</p>}
  </ConnectionRow>
}

export function StudioConnections({ clientId, connection, driveNotice, showTabs = false }: { clientId: string; connection: StudioConnection; driveNotice?: StudioDriveNotice; showTabs?: boolean }) {
  const t = useTranslations('conversationStudio')
  const lang = useLocale()
  const gsc = gscConnectionStatus(connection)
  return <main className="as-page space-y-6"><StudioSectionHeader clientId={clientId} active="connections" showTabs={showTabs} title={t('nav.connections')} description={t('views.connections.description')} />
    <ul className="as-record-list">
      <ConnectionRow id="studio-gsc-title" title={t('connections.searchConsoleTitle')} status={t(gsc.labelKey)} tone={gsc.tone} action={<Link href={`/${lang}/dashboard/${clientId}/assets`} className="as-button inline-flex items-center gap-2 px-3">{t('connections.viewScope')}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>}>
        <p className="as-small as-muted">{t('sources.notQueried')}</p>
        {gsc.dataThrough && <p className="as-small as-muted">{t('evidence.dataThrough')}: {gsc.dataThrough}</p>}
        {gsc.showCompleteness && <p className="as-small as-muted">{t('connections.completenessPending')}</p>}
      </ConnectionRow>
      {connection.dfs
        ? <DfsSettings clientId={clientId} settings={connection.dfs} />
        : <ConnectionRow id="studio-dfs-title" title={t('evidence.dataForSeo')} status={t('connections.settingsUnavailable')} tone="neutral" tag={t('connections.planned')}>
          <p className="as-small as-muted">{t('readUnavailable')}</p>
        </ConnectionRow>}
      {connection.firecrawl
        ? <FirecrawlSettings clientId={clientId} settings={connection.firecrawl} />
        : <ConnectionRow id="studio-firecrawl-title" title={t('evidence.firecrawl')} status={t('connections.settingsUnavailable')} tone="neutral">
          <p className="as-small as-muted">{t('readUnavailable')}</p>
        </ConnectionRow>}
      {connection.drive && <DriveConnectionCard clientId={clientId} drive={connection.drive} notice={driveNotice} />}
    </ul>
    <p className="as-small as-muted">{t('connections.readScopeNote')}</p>
  </main>
}

const STUDIO_TOOL_GROUPS = [
  { key: 'audit', items: ['overview', 'scan', 'results', 'improve', 'opportunities'] },
  { key: 'monitor', items: ['monitor', 'roi', 'observations', 'prompts', 'competitors', 'citations'] },
  { key: 'library', items: ['entities', 'sources', 'reports', 'account'] },
  { key: 'admin', items: ['admin'] },
] as const

const TOOL_NAV_DESCRIPTIONS: Record<string, string> = {
  overview: 'nav_overview_desc', scan: 'nav_scan_desc', results: 'nav_results_desc', improve: 'nav_improve_desc',
  monitor: 'nav_monitor_desc', roi: 'nav_roi_desc', reports: 'nav_reports_desc', account: 'nav_account_desc',
}

export function StudioTools({ clientId, features, admin, mcpEnabled = false, showTabs = false }: { clientId: string; features: NavFeatures; admin: boolean; mcpEnabled?: boolean; showTabs?: boolean }) {
  const t = useTranslations('conversationStudio')
  const dashboard = useTranslations('dashboard')
  const lang = useLocale()
  const tools = buildStudioTools({ lang, clientId, features, admin, conversationStudio: true })
  return <main className="as-page space-y-6"><StudioSectionHeader clientId={clientId} active="tools" showTabs={showTabs} title={t('nav.tools')} description={t('views.tools.description')} />
    <div className="space-y-6">{STUDIO_TOOL_GROUPS.map(group => {
      const items = tools.filter(tool => (group.items as readonly string[]).includes(tool.key))
      if (!items.length) return null
      return <section key={group.key} aria-labelledby={`studio-tools-${group.key}`} className="space-y-3">
        <div className="space-y-1"><h2 id={`studio-tools-${group.key}`}>{t(`tools.groups.${group.key}`)}</h2><p className="as-small as-muted">{t(`tools.groups.${group.key}Body`)}</p></div>
        <div className="as-tool-grid">{items.map(tool => {
          const navKey = TOOL_NAV_DESCRIPTIONS[tool.key]
          return <Link key={tool.key} href={tool.href} className="as-card as-tool flex items-start gap-3">
            <span className="min-w-0 flex-1"><span className="block font-semibold">{dashboard(tool.labelKey)}</span><span className="as-small as-muted mt-1 block">{navKey ? dashboard(navKey) : t(`tools.${tool.key}`)}</span></span>
            {tool.locked && <Lock className="size-4 shrink-0" aria-label={t('planRequired')} />}
            {tool.badge && <span className="as-badge">{tool.badge}</span>}
            <ArrowUpRight className="size-4 shrink-0 as-blue" aria-hidden="true" />
          </Link>
        })}</div>
      </section>
    })}</div>
    {mcpEnabled && <StudioConnectAssistant clientId={clientId} />}
  </main>
}
