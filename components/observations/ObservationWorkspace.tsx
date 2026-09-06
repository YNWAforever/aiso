'use client'

import { useEffect, useRef, useState } from 'react'
import type { ObservationResponse } from '@/lib/observations/types'

import type { ObservationCopy } from './copy'
export type { ObservationCopy } from './copy'
export type ObservationFilters = {
  promptId?: string
  platform?: string
  week?: string
  result?: 'success' | 'incomplete'
  limit?: string
}
type Props = {
  clientId: string
  initial: ObservationResponse
  copy: ObservationCopy
  lang: string
  initialFilters?: ObservationFilters
}
const format = (value: string, count: number) =>
  value.replace('{count}', String(count))

export function ObservationWorkspace(props: Props) {
  return <Workspace key={`${props.clientId}:${props.lang}`} {...props} />
}

function Workspace({
  clientId,
  initial,
  copy,
  lang,
  initialFilters = {},
}: Props) {
  const [data, setData] = useState(initial)
  const [filters, setFilters] = useState({
    ...initialFilters,
    week: initialFilters.week ?? initial.selectedWeek ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
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

  function select(
    key: 'promptId' | 'platform' | 'result' | 'week',
    value: string,
  ) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    void load(next)
  }
  const field =
    'block w-full min-w-0 min-h-11 rounded-lg border border-border bg-background px-3'
  const weeks = [...new Set([filters.week, ...data.weeks].filter(Boolean))]
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
        <label className="min-w-0">
          {copy.platform}
          <select
            className={field}
            value={filters.platform ?? ''}
            onChange={(event) => select('platform', event.target.value)}
          >
            <option value="">{copy.allPlatforms}</option>
            {platforms.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
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
            <p>{copy.unknownModel}</p>
            <p>{copy.unknownMarket}</p>
            <p>{copy.unknownCollectionTime}</p>
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
    </main>
  )
}
