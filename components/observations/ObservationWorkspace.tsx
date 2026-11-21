'use client'

import { useEffect, useRef, useState } from 'react'
import { observationSearch, observationSelection, observationsHref, monitoringHref, type ObservationSelection } from '@/lib/observations/links'
import type { RunTroubleshooting as RunDto } from '@/lib/observations/run-troubleshooting'
import { RunTroubleshooting } from './RunTroubleshooting'
import { formatDisplayDate } from '@/lib/format/date'
import type { ObservationResponse } from '@/lib/observations/types'
import {ObservationDetail} from './ObservationDetail'
import { MaintenanceNextSteps } from '@/components/workspace/MaintenanceNextSteps'
import { PULSE_ACTIVE_QUESTIONS_PER_BRAND } from '@/lib/pulse/limits'
import { groupObservations } from '@/lib/observations/group'
import { platformLabel } from '@/lib/view-models/monitor-signals'

import type { ObservationCopy } from './copy'
export type { ObservationCopy } from './copy'
export type ObservationFilters = ObservationSelection
type Props = {
  initialObservationId?:string
  clientId: string
  initial: ObservationResponse
  copy: ObservationCopy
  lang: string
  initialFilters?: ObservationFilters
  runData?: RunDto | null
  /** Approved SME copilot layout: plain-language page instead of the evidence table. */
  smeCopilot?: boolean
  /** The page already renders the shared What AI says shell and header. */
  embedded?: boolean
}
const queryKey = (selection: ObservationSelection) => observationSearch(selection).toString()
const format = (value: string, count: number) =>
  value.replace('{count}', String(count))
const fill = (value: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, replacement]) => text.replaceAll(`{${key}}`, String(replacement)), value)

export function ObservationWorkspace(props: Props) {
  return <Workspace key={`${props.clientId}:${props.lang}`} {...props} />
}

function Workspace({
  clientId,initialObservationId,
  initial,
  copy,
  lang,
  initialFilters = {},
  runData,
  smeCopilot = false,
  embedded = false,
}: Props) {
  const [data, setData] = useState(initial)
  const [filters, setFilters] = useState<ObservationSelection>({
    ...initialFilters,
    week: initialFilters.week ?? initial.selectedWeek ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'unavailable' | 'sign-in' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(initialFilters.observation ?? initialObservationId ?? null)
  const [platformDraft, setPlatformDraft] = useState(initialFilters.platform ?? '')
  const [platformError, setPlatformError] = useState(false)
  const sequence = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const [loadedKey, setLoadedKey] = useState(() => queryKey(filters))
  const loaded = useRef(loadedKey)
  const selectionRef = useRef(filters)
  const openedWithHistory = useRef(false)
  const [answerTrigger, setAnswerTrigger] = useState<HTMLElement | null>(null)
  const answerReturn = useRef<HTMLElement | null>(null)
  const [platforms, setPlatforms] = useState(() => [
    ...new Set(
      [
        initialFilters.platform,
        ...initial.items.map((item) => item.platform),
      ].filter((value): value is string => Boolean(value)),
    ),
  ])
  useEffect(() => {
    function cancelPending() {
      ++sequence.current
      pending.current?.abort()
    }
    function restore() {
      const next = observationSelection(new URLSearchParams(window.location.search))
      next.week ??= initial.selectedWeek ?? undefined
      selectionRef.current = next
      setFilters(next)
      setPlatformDraft(next.platform ?? '')
      setPlatformError(false)
      setDetailId(next.observation ?? null)
      openedWithHistory.current = false
      if (!next.observation && answerReturn.current) {
        const trigger = answerReturn.current
        answerReturn.current = null
        // Give the browser and App Router time to restore the previous hash and scroll position.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (trigger.isConnected) trigger.focus({ preventScroll: true })
        }))
      }
      if (loaded.current !== queryKey(next)) void load(next)
      else {
        cancelPending()
        setBusy(false)
        setError(null)
      }
    }
    window.addEventListener('popstate', restore)
    return () => {
      window.removeEventListener('popstate', restore)
      cancelPending()
    }
    // This view is remounted for server navigations to a different evidence URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load(selection: ObservationSelection) {
    pending.current?.abort()
    const id = ++sequence.current
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 15_000)
    pending.current = controller
    setBusy(true)
    setError(null)
    try {
      const query = observationSearch(selection)
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/observations?${query}`, {
        cache: 'no-store', signal: controller.signal,
      })
      if (response.status === 401) {
        if (id === sequence.current) setError('sign-in')
        return
      }
      if (!response.ok) throw new Error('unavailable')
      const next = (await response.json()) as ObservationResponse
      if (id !== sequence.current) return
      const confirmed = { ...selectionRef.current, week: next.selectedRun?.week ?? (selection.week || next.selectedWeek || undefined) }
      if (confirmed.week !== selectionRef.current.week) updateSelection(confirmed, 'replace')
      loaded.current = queryKey(confirmed)
      setLoadedKey(loaded.current)
      setData(next)
      setPlatforms(current => [...new Set([...current, ...next.items.map(item => item.platform)])])
    } catch {
      if (id === sequence.current) setError('unavailable')
    } finally {
      clearTimeout(deadline)
      if (id === sequence.current) setBusy(false)
    }
  }

  function updateSelection(next: ObservationSelection, history: 'push' | 'replace' = 'push') {
    const address = observationsHref(lang, clientId, next)
    const query = new URL(address, window.location.origin).search
    const target = window.location.pathname + query + window.location.hash
    if (query !== window.location.search) {
      if (history === 'push') window.history.pushState(null, '', target)
      else window.history.replaceState(null, '', target)
    }
    selectionRef.current = next
    setFilters(next)
  }

  function showAnswer(id: string, trigger: HTMLElement) {
    setAnswerTrigger(trigger)
    answerReturn.current = trigger
    updateSelection(selectionRef.current, 'replace')
    openedWithHistory.current = true
    updateSelection({ ...selectionRef.current, observation: id })
    setDetailId(id)
  }

  function closeAnswer() {
    if (openedWithHistory.current) window.history.back()
    else {
      updateSelection({ ...selectionRef.current, observation: undefined }, 'replace')
      setDetailId(null)
    }
  }

  function changeFilters(changes: ObservationSelection, cursor?: string) {
    const next = { ...selectionRef.current, ...changes, cursor, observation: undefined }
    updateSelection(next)
    setDetailId(null)
    void load(next)
  }

  function submitPlatform(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const valid = platformDraft.length === 0 || Array.from(platformDraft).length <= 80
    setPlatformError(!valid)
    if (!valid || platformDraft === (filters.platform ?? '')) return
    select('platform', platformDraft)
  }

  function select(key: 'promptId' | 'platform' | 'result' | 'week' | 'mention', value: string) {
    changeFilters(key === 'promptId' ? { promptId: value, question: undefined } : { [key]: value })
  }
  function clearFilters() {
    setPlatformDraft('')
    setPlatformError(false)
    changeFilters({ promptId: undefined, question: undefined, platform: undefined, result: undefined, mention: undefined })
  }
  const field =
    'block w-full min-w-0 min-h-11 rounded-lg border border-border bg-background px-3'
  const weeks = [...new Set([filters.week, ...data.weeks].filter((week): week is string => !!week))]
  const current = loadedKey === queryKey(filters)
  const run = data.selectedRun
  const runStatus = runData !== undefined && <RunTroubleshooting data={runData} selection={filters} lang={lang} clientId={clientId} onOpenAnswer={showAnswer} />
  const backToMonitor = monitoringHref(lang, clientId, filters.run)
  const retry = error === 'sign-in'
    ? <a className="inline-flex min-h-11 items-center underline" href={`/${lang}/auth/login?${new URLSearchParams({ next: observationsHref(lang, clientId, filters) })}`}>{copy.signInToContinue}</a>
    : <button className="min-h-11 underline" onClick={() => void load(filters)}>{copy.retry}</button>
  const scope = run && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm">
    <span className="font-semibold">{fill(run.purpose === 'retest' ? copy.retestScope : copy.weeklyScope, { week: formatDisplayDate(run.week, lang) })}</span>
    <a className="inline-flex min-h-11 items-center underline" href={backToMonitor}>{copy.smeMonitoringStatus}</a>
    <a className="inline-flex min-h-11 items-center underline" href={observationsHref(lang, clientId)}>{copy.browseWeeks}</a>
  </div>
  const detail = detailId && <ObservationDetail key={detailId} clientId={clientId} observationId={detailId}
    copy={copy} lang={lang} selection={filters} restoreFocusTo={answerTrigger} smeCopilot={smeCopilot} onClose={closeAnswer} />
  const weekLabel = (week: string) => formatDisplayDate(week, lang)
  const timeLabel = (date: string | null, fallback: string) => formatDisplayDate(date, lang, { withTime: true, zoneLabel: true }) || fallback
  const questionOptions = data.filterOptions?.questions
  const questionKey = (promptId?: string | null, question?: string) => JSON.stringify([promptId ?? '', question ?? ''])
  const questionValue = filters.promptId || filters.question ? questionKey(filters.promptId, filters.question) : ''
  const historicalQuestions = questionOptions?.map(option => ({ value: questionKey(option.promptId, option.question), ...option }))
  const questionControl = <label className="min-w-0">
    {copy.question}
    <select className={field} value={historicalQuestions ? questionValue : filters.promptId ?? ''} onChange={event => {
      const value = event.target.value
      const match = historicalQuestions?.find(option => option.value === value)
      if (historicalQuestions) changeFilters({ promptId: match?.promptId ?? undefined, question: match?.question })
      else select('promptId', value)
    }}>
      <option value="">{copy.allQuestions}</option>
      {historicalQuestions ? <>
        {questionValue && !historicalQuestions.some(option => option.value === questionValue) &&
          <option value={questionValue}>{filters.question ?? data.questions.find(question => question.id === filters.promptId)?.question ?? copy.archivedQuestion}</option>}
        {historicalQuestions.map(option => <option key={option.value} value={option.value}>{option.question}</option>)}
      </> : <>
        {filters.promptId && !data.questions.some(question => question.id === filters.promptId) &&
          <option value={filters.promptId}>{copy.archivedQuestion}</option>}
        {data.questions.map(question => <option key={question.id} value={question.id}>{question.question}</option>)}
      </>}
    </select>
  </label>
  const platformControl = data.filterOptions ? <label className="min-w-0">
    {copy.platform}
    <select className={field} value={filters.platform ?? ''} onChange={event => select('platform', event.target.value)}>
      <option value="">{copy.allPlatforms}</option>
      {[...new Set([...(filters.platform ? [filters.platform] : []), ...data.filterOptions.platforms])].map(platform =>
        <option key={platform} value={platform}>{platformLabel(platform)}</option>)}
    </select>
  </label> : <form className="min-w-0" onSubmit={submitPlatform}>
    <label>
      {copy.platform}
      <input aria-describedby="observation-platform-error" aria-invalid={platformError} className={field}
        list="observation-platforms" name="platform" placeholder={copy.allPlatforms} value={platformDraft}
        onChange={event => { setPlatformDraft(event.target.value); setPlatformError(false) }} />
    </label>
    <datalist id="observation-platforms">{platforms.map(value => <option key={value} value={value} />)}</datalist>
    <button className="mt-1 min-h-11 underline" disabled={busy} type="submit">{copy.applyPlatform}</button>
    <p id="observation-platform-error" role={platformError ? 'alert' : undefined}>{platformError ? copy.platformInvalid : ''}</p>
  </form>
  const mentionControl = <label className="min-w-0">
    {copy.mentionFilter}
    <select className={field} value={filters.mention ?? ''} onChange={event => select('mention', event.target.value)}>
      <option value="">{copy.allResults}</option>
      <option value="mentioned">{copy.smeMentioned}</option>
      <option value="absent">{copy.smeNotMentioned}</option>
      <option value="unknown">{copy.smeMentionUnknown}</option>
    </select>
  </label>


  if (smeCopilot) {
    const badge = 'inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium'
    const filterCount = [filters.promptId || filters.question, filters.platform, filters.result, filters.mention].filter(Boolean).length
    const activeQuestions = data.questions.filter(question => question.isActive === true).length
    const pausedQuestions = data.questions.filter(question => question.isActive === false).length
    // API counters are scoped to the selected week/question/platform, before result filtering.
    const matchingRecords = filters.result === 'success' ? data.counts.successfulRows
      : filters.result === 'incomplete' ? data.counts.incompleteRows : data.counts.recordedRows
    const mention = (item: ObservationResponse['items'][number]) => item.brandMentioned === null
      ? copy.smeMentionUnknown
      : item.brandMentioned ? copy.smeMentioned : copy.smeNotMentioned

    const stats = [
      [copy.smeMonitored, `${activeQuestions}${data.questionsTruncated ? '+' : ''}`],
      [copy.smeRecorded, current ? String(matchingRecords) : '—'],
    ]
    const groups = current ? groupObservations(data.items) : []

    const content = (
      <>
        {scope}
        {runStatus}
        <section aria-label={copy.smeStatsLabel} className="grid grid-cols-2 gap-3">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 break-words text-xl font-semibold">{value}</p>
            </div>
          ))}
        </section>
        <section aria-labelledby="sme-answers-title" className="space-y-3">
          <div className="space-y-1">
            <h2 id="sme-answers-title" tabIndex={-1} className="text-lg font-semibold">{copy.smeAnswersTitle}</h2>
            <p className="text-sm text-muted-foreground">{copy.smeAnswersHint}</p>
          </div>
          {!filters.run || !run ? <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
            <span>{copy.week}</span>
            <select className={field + ' sm:max-w-52'} value={filters.week ?? ''} onChange={(event) => select('week', event.target.value)}>
              {!weeks.length && <option value="">{copy.smeNoRecord}</option>}
              {weeks.map((value) => (<option key={value} value={value}>{weekLabel(value!)}</option>))}
            </select>
          </label> : null}
          <details className="rounded-xl border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">
              <span>{copy.smeFilter}</span>
              {filterCount > 0 && <span className={badge}>{copy.smeFilterActive} · {filterCount}</span>}
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              <section className="grid gap-3 sm:grid-cols-3" aria-label={copy.smeFilter}>
                {questionControl}
                {platformControl}
                {mentionControl}
                <label className="min-w-0">
                  {copy.result}
                  <select className={field} value={filters.result ?? ''} onChange={(event) => select('result', event.target.value)}>
                    <option value="">{copy.allResults}</option>
                    <option value="success">{copy.smeComplete}</option>
                    <option value="incomplete">{copy.smeIncomplete}</option>
                  </select>
                </label>
              </section>
              {filterCount > 0 && <button className="min-h-11 underline" type="button" onClick={clearFilters}>{copy.smeClearFilters}</button>}
            </div>
          </details>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{busy ? copy.loading : ''}</p>
          {error && (
            <p role="alert" className="rounded-lg border border-border bg-card p-4">
              {copy.loadError}{' '}
              {retry}
            </p>
          )}
          <div className="space-y-3" aria-busy={busy}>
            {current && !data.items.length && !busy && !error && (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
                <p className="font-semibold">{filterCount > 0 ? copy.smeNoFiltered : copy.smeNoRecordsTitle}</p>
                {filterCount === 0 && <>
                  <p className="mt-1 text-sm text-muted-foreground">{copy.smeNoRecordsBody}</p>
                  {!run && <a className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium" href={backToMonitor}>{copy.smeMonitoringStatus}</a>}
                </>}
                {filterCount > 0 && <button className="mt-3 min-h-11 underline" type="button" onClick={clearFilters}>{copy.smeClearFilters}</button>}
              </div>
            )}
            {groups.map((group) => (
              <article key={group.key} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-semibold">{group.question}</h3>
                  <span className={badge}>{fill(copy.smeGroupMeta, {
                    platforms: group.platforms.length,
                    mentioned: group.mentioned,
                    notMentioned: group.notMentioned,
                  })}</span>
                </div>
                <ul className="mt-3 divide-y divide-border">
                  {group.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{platformLabel(item.platform)}</span>
                        <span className={item.brandMentioned === true ? badge + ' bg-tone-success-soft' : badge}>{mention(item)}</span>
                        {item.result !== 'success' && <span className={badge}>{item.hasAnswer ? copy.smeIncomplete : copy.noAnswer}</span>}
                        <details className="min-w-0">
                          <summary className="min-h-11 cursor-pointer py-2 text-xs text-muted-foreground">{copy.smeDetails}</summary>
                          <dl className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                            <div><dt>{copy.week}</dt><dd className="break-words">{weekLabel(item.scanWeek)}</dd></div>
                            <div><dt>{copy.recordedAt}</dt><dd className="break-words">{timeLabel(item.recordedAt, copy.unknownRecordedAt)}</dd></div>
                            <div><dt>{copy.collectedAt}</dt><dd className="break-words">{timeLabel(item.collectedAt, copy.unknownCollectionTime)}</dd></div>
                            <div><dt>{copy.model}</dt><dd className="break-words">{item.model ?? copy.unknownModel}</dd></div>
                            <div><dt>{copy.market}</dt><dd className="break-words">{item.market ?? copy.unknownMarket}</dd></div>
                          </dl>
                        </details>
                      </div>
                      <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium" onClick={event => showAnswer(item.id, event.currentTarget)}>{item.hasAnswer ? copy.smeViewAnswer : copy.smeViewRecord}</button>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {current && (data.nextCursor || filters.cursor) && <p className="text-sm text-muted-foreground">{copy.smeGroupPageNote}</p>}
          </div>
          {current && data.nextCursor && (
            <div className="flex justify-center">
              <button className="min-h-11 rounded-lg border border-border px-4" disabled={busy || error !== null} onClick={() => changeFilters({}, data.nextCursor!)}>{copy.next}</button>
            </div>
          )}
        </section>
        <section aria-labelledby="sme-monitoring-title" className="rounded-xl border border-border bg-card">
          <details>
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">
              <span id="sme-monitoring-title">{copy.smeMonitoringTitle} ({data.questions.length})</span>
            </summary>
            <div className="space-y-2 border-t border-border p-4">
              <p className="text-sm text-muted-foreground">{copy.smeMonitoringHint}</p>
              {pausedQuestions > 0 && (
                <p className="text-sm text-muted-foreground">
                  {fill(copy.smeMonitoringCap, { max: PULSE_ACTIVE_QUESTIONS_PER_BRAND, paused: pausedQuestions })}
                </p>
              )}
              {!data.questions.length && <p className="text-sm">{copy.smeNoQuestions}</p>}
              <ul className="divide-y divide-border">
                {data.questions.map((question) => (
                  <li key={question.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <span className="min-w-0 break-words text-sm">{question.question}</span>
                    <span className={badge}>{question.isActive === null ? copy.smeActivityUnknown : question.isActive ? copy.smeActive : copy.smeInactive}</span>
                  </li>
                ))}
              </ul>
              {data.questionsTruncated && <p className="text-xs text-muted-foreground">{copy.questionsTruncated}</p>}
            </div>
          </details>
        </section>
        {detail}
      </>
    )
    if (embedded) return <div className="min-w-0 space-y-6">{content}</div>
    return (
      <main className="mx-auto w-full min-w-0 max-w-5xl space-y-6 p-4 md:p-8">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy.smeEyebrow}</p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-bold">{copy.smeTitle}</h1>
              <p className="text-sm text-muted-foreground">{copy.smeDescription}</p>
            </div>
            <a className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-4 text-sm font-medium" href={'/' + lang + '/dashboard/' + encodeURIComponent(clientId) + '/prompts'}>{copy.smeManageQuestions}</a>
          </div>
        </header>
        {content}
      </main>
    )
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 id="observation-heading" tabIndex={-1} className="text-2xl font-bold">{copy.title}</h1>
        <p>{copy.description}</p>
        <a
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/prompts`}
        >
          {copy.managePrompts}
        </a>
      </header>
      {scope}
      {runStatus}
      <section aria-label={copy.monitoredQuestions} className="space-y-2">
        <h2 className="font-semibold">{copy.monitoredQuestions}</h2>
        {!data.questions.length && <p>{copy.noQuestions}</p>}
        <ul className="space-y-2">
          {data.questions.map((question) => (
            <li key={question.id} className="break-words">
              <p>{question.question}</p>
              <p>
                {question.isActive === null
                  ? copy.activityUnknown
                  : question.isActive
                    ? copy.active
                    : copy.inactive}{' '}
                · {copy.category}: {question.category ?? copy.unknown} ·{' '}
                {copy.language}: {question.language ?? copy.unknown}
              </p>
            </li>
          ))}
        </ul>
        {data.questionsTruncated && <p>{copy.questionsTruncated}</p>}
      </section>
      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label={copy.title}
      >
        {questionControl}
        {platformControl}
        {mentionControl}
        {!run && <label className="min-w-0">
          {copy.week}
          <select
            className={field}
            value={filters.week ?? ''}
            onChange={(event) => select('week', event.target.value)}
          >
            {!weeks.length && <option value="">{copy.unknown}</option>}
            {weeks.map((value) => (
              <option key={value} value={value}>{weekLabel(value!)}</option>
            ))}
          </select>
        </label>}
        <label className="min-w-0">
          {copy.result}
          <select
            className={field}
            value={filters.result ?? ''}
            onChange={(event) => select('result', event.target.value)}
          >
            <option value="">{copy.allResults}</option>
            <option value="success">{copy.success}</option>
            <option value="incomplete">{copy.incomplete}</option>
          </select>
        </label>
      </section>
      <p>{copy.retainedWeeks}</p>
      <div className="flex flex-wrap gap-4" hidden={!current}>
        <strong>{format(copy.recordedRows, data.counts.recordedRows)}</strong>
        <strong>
          {format(
            data.counts.successfulRows === 1
              ? copy.successfulRows
              : copy.successfulRowsPlural,
            data.counts.successfulRows,
          )}
        </strong>
        <strong>
          {format(copy.incompleteRows, data.counts.incompleteRows)}
        </strong>
      </div>
      <p role="status" aria-live="polite">
        {busy ? copy.loading : ''}
      </p>
      {error && (
        <p role="alert">
          {copy.loadError}{' '}
          {retry}
        </p>
      )}
      <section className="grid gap-4" aria-busy={busy}>
        {current && !data.items.length && !busy && !error && (
          <p>
            {!data.weeks.length && !data.selectedWeek
              ? copy.noData
              : copy.empty}
          </p>
        )}
        {current && data.items.map((item) => (
          <article
            key={item.id}
            className="min-w-0 break-words rounded-xl border border-border bg-card p-4"
          >
            <h2 className="font-semibold">
              {copy.historicalQuestion}: {item.question}
            </h2>
            {item.currentPrompt && (
              <p>
                {copy.currentPrompt}: {item.currentPrompt.question} ·{' '}
                {copy.category}: {item.currentPrompt.category ?? copy.unknown} ·{' '}
                {copy.language}: {item.currentPrompt.language ?? copy.unknown}
              </p>
            )}
            <p>
              {copy.platform}: {item.platform}
            </p>
            <p>
              {copy.week}: {weekLabel(item.scanWeek)}
            </p>
            <p>
              {copy.recordedAt}:{' '}
              {item.recordedAt ? (
                <time dateTime={item.recordedAt}>{timeLabel(item.recordedAt, copy.unknownRecordedAt)}</time>
              ) : (
                copy.unknownRecordedAt
              )}
            </p>
            <p>
              {copy.result}:{' '}
              {item.result === 'success' ? copy.success : copy.incomplete}
            </p>
            <p>{item.hasAnswer ? copy.hasAnswer : copy.noAnswer}</p>
            <p>
              {item.brandMentioned === null
                ? copy.classificationUnknown
                : item.brandMentioned
                  ? copy.brandMentioned
                  : copy.brandNotMentioned}
            </p>
            <p>{item.model?`${copy.model}: ${item.model}`:copy.unknownModel}</p>
            <p>{item.market?`${copy.market}: ${item.market}`:copy.unknownMarket}</p>
            <p>{item.collectedAt?`${copy.collectedAt}: ${timeLabel(item.collectedAt, copy.unknownCollectionTime)}`:copy.unknownCollectionTime}</p>
            <button type="button" className="min-h-11 rounded-lg border px-3" onClick={event => showAnswer(item.id, event.currentTarget)}>{copy.viewDetails}</button>
          </article>
        ))}
      </section>
      {current && data.nextCursor && (
        <button
          className="min-h-11 rounded-lg border px-4"
          disabled={busy || error !== null}
          onClick={() => changeFilters({}, data.nextCursor!)}
        >
          {copy.next}
        </button>
      )}
      {detail}
      <MaintenanceNextSteps clientId={clientId} lang={lang} current="observations" copy={copy}/>
    </main>
  )
}
