'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import { useStudioSession } from '@/components/dashboard/StudioSession'
import { StudioSectionHeader } from '@/components/dashboard/StudioSectionHeader'
import type { StudioHomeTemplate } from '@/lib/conversation-studio/home'
import type { StudioOverview, StudioWeek } from '@/lib/conversation-studio/overview'
import { summarizeStudioWeeks, weekPercent } from '@/lib/conversation-studio/weekly-view'

type Section = { status: string }

/** Starts a fresh thread from a skill: the same seeding a skill card on Start work does. */
function useStartSkill(clientId: string) {
  const t = useTranslations('conversationStudio')
  const session = useStudioSession()
  const router = useRouter()
  const lang = useLocale()
  return (skill: StudioHomeTemplate, prompt?: string) => {
    session.setActiveId(null)
    session.setNewDraft(prompt ?? t(`templates.${skill}.prompt`))
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

function WeeklyReport({ summary, onStart }: { summary: NonNullable<ReturnType<typeof summarizeStudioWeeks>>; onStart: (skill: StudioHomeTemplate, prompt?: string) => void }) {
  const t = useTranslations('conversationStudio.weekly')
  const latestPercent = weekPercent(summary.latest)
  const delta = summary.delta
  const comparison = latestPercent === null
    ? t('noAnswers')
    : delta === null
      ? t('noComparison')
      : delta === 0
        ? t('deltaFlat')
        : delta > 0
          ? t('deltaUp', { points: Math.abs(delta).toFixed(1) })
          : t('deltaDown', { points: Math.abs(delta).toFixed(1) })
  return <section className="as-card space-y-5" aria-labelledby="studio-weekly-summary">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 id="studio-weekly-summary" className="as-small as-muted font-semibold">{t('latestLabel')}</h2>
        <p className="as-metric">{latestPercent === null ? t('noAnswersValue') : `${latestPercent}%`}</p>
        <p className="as-small as-muted">{t('mentionsValue', { mentions: summary.latest.brandMentions, total: summary.latest.totalQueries })}</p>
      </div>
      <p className="as-small as-muted max-w-[34ch]">{comparison}</p>
    </div>
    <div className="space-y-2">
      <h2 className="as-small as-muted font-semibold">{t('trendTitle')}</h2>
      <ol className="space-y-2">
        {summary.weeks.map((week, index) => {
          const value = weekPercent(week)
          return <li key={week.week} className="space-y-1 rounded-md px-2 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="as-small font-semibold">{week.week}{index === 0 && <span className="as-badge ml-2">{t('latest')}</span>}</span>
              <span className="as-small as-muted">{t('mentionsValue', { mentions: week.brandMentions, total: week.totalQueries })}</span>
              <span className="as-small font-semibold tabular-nums">{value === null ? t('noAnswersValue') : `${value}%`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: `${value === null ? 0 : Math.max(2, Math.min(100, value))}%` }} />
            </div>
          </li>
        })}
      </ol>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="as-small as-muted max-w-[52ch]">{t('scopeNote')}</p>
      {latestPercent !== null && <button type="button" className="as-button as-primary inline-flex items-center gap-2 px-4" onClick={() => onStart('pulse', t('openThreadPrompt', { week: summary.latest.week }))}>{t('openThread')}<ArrowRight className="size-4" aria-hidden="true" /></button>}
    </div>
  </section>
}

export function StudioWeeklyView({ clientId, weeks, showTabs = false }: { clientId: string; weeks: StudioOverview['weeks']; showTabs?: boolean }) {
  const t = useTranslations('conversationStudio.weekly')
  const lang = useLocale()
  const start = useStartSkill(clientId)
  const summary = weeks.status === 'ok' ? summarizeStudioWeeks(weeks.data) : null
  return <main className="as-page space-y-6">
    <StudioSectionHeader clientId={clientId} active="weekly" showTabs={showTabs} title={t('title')} description={t('subtitle')} action={<Link className="as-button inline-flex items-center px-3" href={`/${lang}/dashboard/${clientId}/reports`}>{t('clientReports')}</Link>} />
    {weeks.status === 'unavailable'
      ? <p className="as-muted">{t('unavailable')}</p>
      : !summary
        ? <div className="as-empty space-y-2"><h2>{t('emptyTitle')}</h2><p className="as-muted">{t('empty')}</p></div>
        : <WeeklyReport summary={summary} onStart={start} />}
  </main>
}
