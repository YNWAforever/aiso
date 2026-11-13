'use client'

import { useEffect, useRef, useState,type ReactNode } from 'react'
import type { ObservationResponse } from '@/lib/observations/types'
import {ObservationDetail} from './ObservationDetail'
import { MaintenanceNextSteps } from '@/components/workspace/MaintenanceNextSteps'

import type { ObservationCopy } from './copy'
export type { ObservationCopy } from './copy'
export type ObservationFilters = {
  run?:string
  promptId?: string
  platform?: string
  week?: string
  result?: 'success' | 'incomplete'
  limit?: string
}
type Props = {
  initialObservationId?:string
  clientId: string
  initial: ObservationResponse
  copy: ObservationCopy
  lang: string
  initialFilters?: ObservationFilters
  runPanel?:ReactNode
  /** Approved SME copilot layout: plain-language page instead of the evidence table. */
  smeCopilot?: boolean
}
const format = (value: string, count: number) =>
  value.replace('{count}', String(count))

export function ObservationWorkspace(props: Props) {
  return <Workspace key={`${props.clientId}:${props.lang}`} {...props} />
}

function Workspace({
  clientId,initialObservationId,
  initial,
  copy,
  lang,
  initialFilters = {},
  runPanel,
  smeCopilot = false,
}: Props) {
  const [data, setData] = useState(initial)
  const [filters, setFilters] = useState({
    ...initialFilters,
    week: initialFilters.week ?? initial.selectedWeek ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [detailId,setDetailId]=useState<string|null>(initialObservationId??null)
  const [platformDraft, setPlatformDraft] = useState(initialFilters.platform ?? '')
  const [platformError, setPlatformError] = useState(false)
  const sequence = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const lastRequest = useRef<Record<string, string>>({})
  const [platforms, setPlatforms] = useState(() => [
    ...new Set(
      [
        initialFilters.platform,
        ...initial.items.map((item) => item.platform),
      ].filter((value): value is string => Boolean(value)),
    ),
  ])
  useEffect(
    () => () => {
      ++sequence.current
      pending.current?.abort()
    },
    [],
  )

  async function load(nextFilters: typeof filters, cursor = '') {
    pending.current?.abort()
    const id = ++sequence.current
    const controller = new AbortController()
    pending.current = controller
    const request = { ...nextFilters, cursor }
    lastRequest.current = request
    setBusy(true)
    setError(false)
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(request))
      if (value) query.set(key, value)
    try {
      const response = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/observations?${query}`,
        { cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('unavailable')
      const next = (await response.json()) as ObservationResponse
      if (id !== sequence.current) return
      setData(next)
      // Pin the server-selected window, including when an initially empty client gains records.
      setFilters((current) => ({
        ...current,
        week: nextFilters.week || next.selectedWeek || '',
      }))
      setPlatforms((current) => [
        ...new Set([...current, ...next.items.map((item) => item.platform)]),
      ])
    } catch {
      if (id === sequence.current && !controller.signal.aborted) setError(true)
    } finally {
      if (id === sequence.current) setBusy(false)
    }
  }

  function submitPlatform(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const valid = platformDraft.length === 0 || Array.from(platformDraft).length <= 80
    setPlatformError(!valid)
    if (!valid || platformDraft === (filters.platform ?? '')) return
    select('platform', platformDraft)
  }

  function select(
    key: 'promptId' | 'platform' | 'result' | 'week',
    value: string,
  ) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    void load(next)
  }
  function clearFilters() {
    // Clear optional filters without losing the selected run, week or page size.
    const next = { ...filters, promptId: '', platform: '', result: undefined }
    setFilters(next)
    setPlatformDraft('')
    setPlatformError(false)
    void load(next)
  }
  const field =
    'block w-full min-w-0 min-h-11 rounded-lg border border-border bg-background px-3'
  const weeks = [...new Set([filters.week, ...data.weeks].filter(Boolean))]

  if (smeCopilot) {
    const badge = 'inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium'
    const filterCount = [filters.promptId, filters.platform, filters.result].filter(Boolean).length
    const activeQuestions = data.questions.filter(question => question.isActive === true).length
    // API counters are scoped to the selected week/question/platform, before result filtering.
    const matchingRecords = filters.result === 'success' ? data.counts.successfulRows
      : filters.result === 'incomplete' ? data.counts.incompleteRows : data.counts.recordedRows
    const mention = (item: ObservationResponse['items'][number]) => item.brandMentioned === null
      ? copy.smeMentionUnknown
      : item.brandMentioned ? copy.smeMentioned : copy.smeNotMentioned

    const stats = [
      [copy.smeMonitored, `${activeQuestions}${data.questionsTruncated ? '+' : ''}`],
      [copy.smeRecorded, String(matchingRecords)],
    ]

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
        {runPanel}
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
            <h2 id="sme-answers-title" className="text-lg font-semibold">{copy.smeAnswersTitle}</h2>
            <p className="text-sm text-muted-foreground">{copy.smeAnswersHint}</p>
          </div>
          <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
            <span>{copy.week}</span>
            <select className={field + ' sm:max-w-52'} value={filters.week} onChange={(event) => select('week', event.target.value)}>
              {!weeks.length && <option value="">{copy.smeNoRecord}</option>}
              {weeks.map((value) => (<option key={value}>{value}</option>))}
            </select>
          </label>
          <details className="rounded-xl border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">
              <span>{copy.smeFilter}</span>
              {filterCount > 0 && <span className={badge}>{copy.smeFilterActive} · {filterCount}</span>}
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              <section className="grid gap-3 sm:grid-cols-3" aria-label={copy.smeFilter}>
                <label className="min-w-0">
                  {copy.question}
                  <select className={field} value={filters.promptId ?? ''} onChange={(event) => select('promptId', event.target.value)}>
                    <option value="">{copy.allQuestions}</option>
                    {filters.promptId && !data.questions.some((question) => question.id === filters.promptId) && (
                      <option value={filters.promptId}>{copy.archivedQuestion}</option>
                    )}
                    {data.questions.map((question) => (
                      <option key={question.id} value={question.id}>{question.question}</option>
                    ))}
                  </select>
                </label>
                <form className="min-w-0" onSubmit={submitPlatform}>
                  <label>
                    {copy.platform}
                    <input aria-describedby="observation-platform-error" aria-invalid={platformError} className={field} list="observation-platforms" name="platform" placeholder={copy.allPlatforms} value={platformDraft} onChange={(event) => { setPlatformDraft(event.target.value); setPlatformError(false) }} />
                  </label>
                  <datalist id="observation-platforms">
                    {platforms.map((value) => (<option key={value} value={value} />))}
                  </datalist>
                  <button className="mt-1 min-h-11 underline" disabled={busy} type="submit">{copy.applyPlatform}</button>
                  <p id="observation-platform-error" role={platformError ? 'alert' : undefined}>{platformError ? copy.platformInvalid : ''}</p>
                </form>
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
              <button className="min-h-11 underline" onClick={() => void load(filters, lastRequest.current.cursor)}>{copy.retry}</button>
            </p>
          )}
          <div className="space-y-3" aria-busy={busy}>
            {!data.items.length && !busy && !error && (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
                <p className="font-semibold">{filterCount > 0 ? copy.smeNoFiltered : copy.smeNoRecordsTitle}</p>
                {filterCount === 0 && <p className="mt-1 text-sm text-muted-foreground">{copy.smeNoRecordsBody}</p>}
                {filterCount > 0 && <button className="mt-3 min-h-11 underline" type="button" onClick={clearFilters}>{copy.smeClearFilters}</button>}
              </div>
            )}
            {data.items.map((item) => (
              <article key={item.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h3 className="min-w-0 break-words font-semibold">{item.question}</h3>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={badge}>{item.platform}</span>
                  <span className={badge}>{item.scanWeek}</span>
                  <span className={badge}>{item.result === 'success' ? copy.smeComplete : item.hasAnswer ? copy.smeIncomplete : copy.noAnswer}</span>
                  <span className={item.brandMentioned === true ? badge + ' bg-tone-success-soft' : badge}>{mention(item)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium" onClick={() => setDetailId(item.id)}>{item.hasAnswer ? copy.smeViewAnswer : copy.smeViewRecord}</button>
                  <details className="min-w-0">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground">{copy.smeDetails}</summary>
                    <dl className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <div><dt>{copy.recordedAt}</dt><dd className="break-words">{item.recordedAt ?? copy.unknown}</dd></div>
                      <div><dt>{copy.collectedAt}</dt><dd className="break-words">{item.collectedAt ?? copy.unknownCollectionTime}</dd></div>
                      <div><dt>{copy.model}</dt><dd className="break-words">{item.model ?? copy.unknownModel}</dd></div>
                      <div><dt>{copy.market}</dt><dd className="break-words">{item.market ?? copy.unknownMarket}</dd></div>
                    </dl>
                  </details>
                </div>
              </article>
            ))}
          </div>
          {data.nextCursor && (
            <div className="flex justify-center">
              <button className="min-h-11 rounded-lg border border-border px-4" disabled={busy || error} onClick={() => void load(filters, data.nextCursor!)}>{copy.next}</button>
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
        {detailId && <ObservationDetail key={detailId} clientId={clientId} observationId={detailId} copy={copy} smeCopilot onClose={() => setDetailId(null)} />}
      </main>
    )
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-bold">{copy.title}</h1>
        <p>{copy.description}</p>
        <a
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/prompts`}
        >
          {copy.managePrompts}
        </a>
      </header>
      {runPanel}
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
        <label className="min-w-0">
          {copy.question}
          <select
            className={field}
            value={filters.promptId ?? ''}
            onChange={(event) => select('promptId', event.target.value)}
          >
            <option value="">{copy.allQuestions}</option>
            {filters.promptId &&
              !data.questions.some(
                (question) => question.id === filters.promptId,
              ) && (
                <option value={filters.promptId}>
                  {copy.archivedQuestion}
                </option>
              )}
            {data.questions.map((question) => (
              <option key={question.id} value={question.id}>
                {question.question}
              </option>
            ))}
          </select>
        </label>
        <form className="min-w-0" onSubmit={submitPlatform}>
          <label>
            {copy.platform}
            <input
              aria-describedby="observation-platform-error"
              aria-invalid={platformError}
              className={field}
              list="observation-platforms"
              name="platform"
              placeholder={copy.allPlatforms}
              value={platformDraft}
              onChange={(event) => {
                setPlatformDraft(event.target.value)
                setPlatformError(false)
              }}
            />
          </label>
          <datalist id="observation-platforms">
            {platforms.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <button className="mt-1 min-h-11 underline" disabled={busy} type="submit">
            {copy.applyPlatform}
          </button>
          <p id="observation-platform-error" role={platformError ? 'alert' : undefined}>
            {platformError ? copy.platformInvalid : ''}
          </p>
        </form>
        <label className="min-w-0">
          {copy.week}
          <select
            className={field}
            value={filters.week}
            onChange={(event) => select('week', event.target.value)}
          >
            {!weeks.length && <option value="">{copy.unknown}</option>}
            {weeks.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
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
      <div className="flex flex-wrap gap-4">
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
          <button
            className="min-h-11 underline"
            onClick={() => void load(filters, lastRequest.current.cursor)}
          >
            {copy.retry}
          </button>
        </p>
      )}
      <section className="grid gap-4" aria-busy={busy}>
        {!data.items.length && !busy && !error && (
          <p>
            {!data.weeks.length && !data.selectedWeek
              ? copy.noData
              : copy.empty}
          </p>
        )}
        {data.items.map((item) => (
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
              {copy.week}: {item.scanWeek}
            </p>
            <p>
              {copy.recordedAt}:{' '}
              {item.recordedAt ? (
                <time dateTime={item.recordedAt}>{item.recordedAt}</time>
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
            <p>{item.collectedAt?`${copy.collectedAt}: ${item.collectedAt}`:copy.unknownCollectionTime}</p>
            <button type="button" className="min-h-11 rounded-lg border px-3" onClick={()=>setDetailId(item.id)}>{copy.viewDetails}</button>
          </article>
        ))}
      </section>
      {data.nextCursor && (
        <button
          className="min-h-11 rounded-lg border px-4"
          disabled={busy || error}
          onClick={() => void load(filters, data.nextCursor!)}
        >
          {copy.next}
        </button>
      )}
      {detailId&&<ObservationDetail key={detailId} clientId={clientId} observationId={detailId} copy={copy} onClose={()=>setDetailId(null)}/>}
      <MaintenanceNextSteps clientId={clientId} lang={lang} current="observations" copy={copy}/>
    </main>
  )
}
