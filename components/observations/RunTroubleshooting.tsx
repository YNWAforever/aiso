import type { RunItemFilter, RunTroubleshooting as RunDto } from '@/lib/observations/run-troubleshooting'
import { observationsHref, type ObservationSelection } from '@/lib/observations/links'
import { platformLabel } from '@/lib/view-models/monitor-signals'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const filters = ['all', 'failed', 'pending', 'unclassified'] as const

export function RunTroubleshooting({ data, lang, clientId, selection, onOpenAnswer, error = false }: {
  data: RunDto | null; lang: string; clientId: string; selection: ObservationSelection; onOpenAnswer?: (id: string) => void; error?: boolean
}) {
  const messages = lang === 'zh-HK' ? zh : en
  const copy = messages.maintenance
  const filter = filters.find(value => value === selection.runStatus)
  const href = (selected: RunItemFilter, cursor?: string) => observationsHref(lang, clientId, {
    ...selection, runStatus: selected, runCursor: cursor, observation: undefined,
  }, '#run-status')

  if (error || !data) return <p role="alert" className="rounded-xl border border-border p-4">
    {copy.runUnavailable}{' '}
    <a className="inline-flex min-h-11 items-center underline" href={observationsHref(lang, clientId, selection, '#run-status')}>{messages.observations.retry}</a>
  </p>

  return <section id="run-status" className="scroll-mt-24 rounded-xl border border-border bg-card p-4 sm:p-5">
    <p className="text-sm font-medium">{copy.runCounts.replace('{succeeded}', String(data.succeeded))
      .replace('{expected}', String(data.expected)).replace('{failed}', String(data.failed)).replace('{pending}', String(data.pending))
      .replace('{blocked}', String(data.blocked)).replace('{classified}', String(data.classified))}</p>
    {filter ? <details open className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">{copy.runTitle}</summary>
      <nav className="flex flex-wrap gap-x-4" aria-label={copy.runFilters}>
        {filters.map(value => <a className="inline-flex min-h-11 items-center underline" key={value} href={href(value)} aria-current={filter === value ? 'page' : undefined}>{copy.filters[value]}</a>)}
      </nav>
      <p className="text-sm text-muted-foreground">{copy.runScope.replace('{shown}', String(data.items.length)).replace('{total}', String(data.total))}</p>
      <ul className="mt-3 divide-y divide-border">{data.items.map(item => <li className="space-y-1 py-3 text-sm" key={item.id}>
        <p className="break-words font-semibold">{item.question}</p>
        <p className="break-words text-muted-foreground">{platformLabel(item.platform)} · {item.model}</p>
        <p>{copy.itemStates[item.status as keyof typeof copy.itemStates] ?? copy.unknown} · {copy.classification}: {item.classification === 'classified' ? copy.classified : copy.unknown} · {copy.attempts}: {item.attempts}</p>
        {item.reason && <p>{messages.runProgress.reasons[item.reason]}</p>}
        {item.observationId && <a className="inline-flex min-h-11 items-center underline" onClick={event => {
          if (!onOpenAnswer || !item.observationId || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          onOpenAnswer(item.observationId)
        }} href={observationsHref(lang, clientId, {
          ...selection, observation: item.observationId,
        }, '#run-status')}>{messages.observations.smeViewAnswer}</a>}
      </li>)}</ul>
      {!data.items.length && <p>{copy.runEmpty}</p>}
      {data.nextCursor && <a className="inline-flex min-h-11 items-center underline" href={href(filter, data.nextCursor)}>{copy.moreRunItems}</a>}
    </details> : <a className="inline-flex min-h-11 items-center underline" href={href('all')}>{copy.runTitle}</a>}
  </section>
}
