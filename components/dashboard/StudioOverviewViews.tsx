'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { useStudioSession } from '@/components/dashboard/StudioSession'
import type { StudioHomeTemplate } from '@/lib/conversation-studio/home'
import type { StudioOverview, StudioWeek } from '@/lib/conversation-studio/overview'

type Section = { status: string }

/** Starts a fresh thread from a skill: the same seeding a skill card on Start work does. */
function useStartSkill(clientId: string) {
  const t = useTranslations('conversationStudio')
  const session = useStudioSession()
  const router = useRouter()
  const lang = useLocale()
  return (skill: StudioHomeTemplate) => {
    session.setActiveId(null)
    session.setNewDraft(t(`templates.${skill}.prompt`))
    session.setNewTemplate(skill)
    router.push(`/${lang}/dashboard/${clientId}/studio`)
  }
}

function StateLine({ section, clientId }: { section: Section; clientId: string }) {
  const t = useTranslations('conversationStudio.overview')
  const lang = useLocale()
  if (section.status === 'unbound') return <p className="as-muted">{t('unbound')} · <Link className="underline" href={`/${lang}/dashboard/${clientId}/studio/connections`}>{t('connect')}</Link></p>
  return <p className="as-muted">{t(section.status === 'not_entitled' ? 'notEntitled' : section.status === 'unavailable' ? 'unavailable' : 'empty')}</p>
}

const percent = (value: number) => `${Math.round(value * 10) / 10}%`

/** Weekly bars, oldest to newest. The list beside it carries the same numbers for screen readers. */
function WeekBars({ weeks }: { weeks: StudioWeek[] }) {
  const ordered = [...weeks].reverse()
  return <div className="as-bars" aria-hidden="true">{ordered.map(week => <span key={week.week} style={{ height: `${Math.max(4, Math.min(100, week.sovScore))}%` }} />)}</div>
}

function Card({ title, children, skill, onStart }: { title: string; children: React.ReactNode; skill: StudioHomeTemplate; onStart: (skill: StudioHomeTemplate) => void }) {
  const t = useTranslations('conversationStudio.overview')
  return <section className="as-card space-y-3" aria-label={title}>
    <h2 className="font-semibold">{title}</h2>
    <div className="space-y-2">{children}</div>
    <button type="button" className="as-link inline-flex min-h-11 items-center gap-1" onClick={() => onStart(skill)}>{t('openThread')}<ArrowRight className="size-4" aria-hidden="true" /></button>
  </section>
}

export function StudioOverviewView({ clientId, brandName, overview }: { clientId: string; brandName: string; overview: StudioOverview }) {
  const t = useTranslations('conversationStudio.overview')
  const start = useStartSkill(clientId)
  // Locale-pinned so the server render and the browser agree.
  const number = new Intl.NumberFormat(useLocale())
  const { visibility, weeks, scan, searchConsole, opportunities } = overview
  return <main className="as-page space-y-6">
    <header className="space-y-1"><h1>{brandName}</h1><p className="as-muted">{t('subtitle')}</p></header>
    <div className="as-card-grid">
      <Card title={t('visibility')} skill="pulse" onStart={start}>
        {visibility.status === 'ok' ? <>
          <p className="as-metric">{percent(visibility.data.sovScore)}</p>
          <p className="as-muted as-small">{t('visibilityDetail', { mentions: visibility.data.brandMentions, total: visibility.data.totalQueries, platforms: visibility.data.platformCount, week: visibility.data.week })}</p>
        </> : <StateLine section={visibility} clientId={clientId} />}
        {weeks.status === 'ok' && weeks.data.length > 1 && <WeekBars weeks={weeks.data} />}
      </Card>
      <Card title={t('scan')} skill="improve" onStart={start}>
        {scan.status === 'ok' ? <>
          <p className="as-metric">{scan.data.score === null ? t(`scanState.${scan.data.state}`) : `${scan.data.score}${scan.data.grade ? ` · ${scan.data.grade}` : ''}`}</p>
          <p className="as-muted as-small">{t('scanDetail', { date: scan.data.recordedAt.slice(0, 10) })}{scan.data.state === 'limited' ? ` · ${t('scanState.limited')}` : ''}</p>
        </> : <StateLine section={scan} clientId={clientId} />}
      </Card>
      <Card title={t('searchConsole')} skill="report" onStart={start}>
        {searchConsole.status === 'ok' ? <>
          <p className="as-metric">{number.format(searchConsole.data.clicks)}</p>
          <p className="as-muted as-small">{t('searchConsoleDetail', { impressions: number.format(searchConsole.data.impressions), through: searchConsole.data.dataThrough ?? t('empty') })}</p>
        </> : <StateLine section={searchConsole} clientId={clientId} />}
      </Card>
      <Card title={t('opportunities')} skill="opportunity" onStart={start}>
        {opportunities.status === 'ok' ? <>
          <p className="as-metric">{opportunities.data.count}</p>
          {opportunities.data.week && <p className="as-muted as-small">{t('opportunitiesDetail', { week: opportunities.data.week })}</p>}
        </> : <StateLine section={opportunities} clientId={clientId} />}
      </Card>
    </div>
  </main>
}

export function StudioWeeklyView({ clientId, weeks }: { clientId: string; weeks: StudioOverview['weeks'] }) {
  const t = useTranslations('conversationStudio.weekly')
  const overview = useTranslations('conversationStudio.overview')
  const lang = useLocale()
  const start = useStartSkill(clientId)
  return <main className="as-page space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1"><h1>{t('title')}</h1><p className="as-muted">{t('subtitle')}</p></div>
      <Link className="as-button inline-flex items-center px-3" href={`/${lang}/dashboard/${clientId}/reports`}>{t('clientReports')}</Link>
    </header>
    {weeks.status !== 'ok' ? <p className="as-muted">{overview(weeks.status === 'unavailable' ? 'unavailable' : 'empty')}</p> : <div className="as-table-scroll relative" tabIndex={0} role="region" aria-label={t('title')}>
      <table className="as-table">
        <thead><tr><th scope="col">{t('week')}</th><th scope="col">{t('sov')}</th><th scope="col">{t('mentions')}</th><th scope="col"><span className="sr-only">{t('actions')}</span></th></tr></thead>
        <tbody>{weeks.data.map(week => <tr key={week.week}>
          <th scope="row">{week.week}</th>
          <td>{percent(week.sovScore)}</td>
          <td>{t('mentionsValue', { mentions: week.brandMentions, total: week.totalQueries })}</td>
          <td><button type="button" className="as-link inline-flex min-h-11 items-center gap-1" onClick={() => start('pulse')}>{overview('openThread')}<span className="sr-only"> · {week.week}</span><ArrowRight className="size-4" aria-hidden="true" /></button></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </main>
}
