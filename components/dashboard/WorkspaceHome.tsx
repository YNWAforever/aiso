import Link from 'next/link'
import type { ReactNode } from 'react'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import type { WorkspaceHome as HomeDto } from '@/lib/view-models/workspace-home'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/** Pure presentation of the owned server projection. Does not fetch or write. */
export function WorkspaceHome({ workspace, lang }: { workspace: HomeDto; lang: string }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).workspaceHome
  const base = `/${lang}/dashboard/${workspace.client.id}`
  const linkClass = 'inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2'
  function panel(title: string, section: { state: 'ready'|'empty'|'error'|'locked'; observedAt: string|null }, children: ReactNode) {
    return <section className="min-w-0 rounded-xl border border-dash-border bg-dash-surface p-5 sm:p-6">
      <h2 className="text-xl font-bold text-dash-text">{title}</h2>
      <p className="mt-2 text-sm text-dash-muted">{copy.freshnessUnknown}</p>
      <p className="mt-1 text-sm text-dash-muted">{section.observedAt ? <>{copy.observedAt}: <time dateTime={section.observedAt}>{section.observedAt.replace('T', ' ').replace('.000Z', ' UTC')}</time></> : copy.noDate}</p>
      <div className="mt-5">{section.state === 'ready' ? children : <p className="text-sm leading-relaxed text-dash-muted">{copy.states[section.state]}</p>}</div>
      {section.state === 'locked' && <Link className={linkClass} href={`/${lang}/pricing`}>{copy.pricing}</Link>}
    </section>
  }
  const health = workspace.siteHealth.data
  const visibility = workspace.visibility.data
  return <main className="mx-auto w-full min-w-0 max-w-6xl break-words px-4 py-8 sm:px-6">
    <header className="mb-8">
      <p className="text-sm font-semibold text-primary">{copy.title}</p>
      <h1 className="mt-2 text-3xl font-bold text-dash-text">{workspace.client.brand_name}</h1>
      <p className="mt-2 text-sm text-dash-muted">{workspace.client.domain}</p>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dash-muted">{copy.summary}</p>
    </header>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      {panel(copy.siteHealth, workspace.siteHealth, health && <>
        <p className="text-sm text-dash-muted">{copy.score}</p>
        <p className="mt-1 text-3xl font-bold text-dash-text">{health.score ?? '—'} / 100 <span className="text-lg">{health.grade ?? '—'}</span></p>
        <div className="mt-5">{health.pillarScores ? <PillarScoreCards results={{ pillarScores: health.pillarScores }} locale={lang} tone="dashboard" /> : <p className="text-sm text-dash-muted">{copy.noPillars}</p>}</div>
        <Link className={linkClass} href={`${base}?step=results&scanId=${encodeURIComponent(health.scanId)}`}>{copy.results}</Link>
      </>)}
      {panel(copy.visibility, workspace.visibility, visibility && <>
        <p className="text-3xl font-bold text-dash-text">{visibility.sovScore}%</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-dash-muted">{copy.mentions}</dt><dd className="font-semibold text-dash-text">{visibility.brandMentions}</dd></div>
          <div><dt className="text-dash-muted">{copy.queries}</dt><dd className="font-semibold text-dash-text">{visibility.totalQueries}</dd></div>
          <div><dt className="text-dash-muted">{copy.platforms}</dt><dd className="font-semibold text-dash-text">{visibility.platformCount}</dd></div>
        </dl>
        <Link className={linkClass} href={`${base}?step=monitor`}>{copy.monitor}</Link>
      </>)}
      {panel(copy.recommendations, workspace.recommendations, <ul className="space-y-4">{workspace.recommendations.data?.map(rec => <li key={rec.id} className="border-b border-dash-border pb-4 last:border-0">
        <p className="text-xs font-semibold text-primary">{copy.draft}</p><p className="mt-2 text-sm leading-relaxed text-dash-text">{rec.recommendation}</p><p className="mt-2 text-xs text-dash-muted">{rec.platform}</p>
      </li>)}</ul>)}
      {panel(copy.history, workspace.history, <ul className="space-y-3">{workspace.history.data?.map(scan => <li key={scan.id}>
        <Link className={linkClass} href={`${base}?step=results&scanId=${encodeURIComponent(scan.id)}`}>{copy.openScan}: {scan.score ?? '—'} / 100 · {scan.grade ?? '—'}</Link>
        <p className="text-xs text-dash-muted"><time dateTime={scan.created_at}>{scan.created_at.replace('T', ' ').replace('.000Z', ' UTC')}</time></p>
      </li>)}</ul>)}
    </div>
    <section className="mt-8 border-t border-dash-border pt-6"><h2 className="text-xl font-bold text-dash-text">{copy.tools}</h2>
      <nav aria-label={copy.tools} className="mt-3 flex flex-wrap gap-2">
        {(['scan','results','improve','monitor','roi'] as const).map(step => <Link key={step} className={linkClass} href={`${base}?step=${step}`}>{copy[step]}</Link>)}
        <Link className={linkClass} href={`${base}/reports`}>{copy.reports}</Link><Link className={linkClass} href={`${base}/prompts`}>{copy.prompts}</Link>
      </nav>
    </section>
  </main>
}
