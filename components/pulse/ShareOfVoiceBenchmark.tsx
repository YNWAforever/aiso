import Link from 'next/link'

import { ALL_PLATFORMS, type ShareOfVoiceView, type SovCell, type SovSubject } from '@/lib/pulse/share-of-voice'
import type en from '@/messages/en.json'

type Copy = (typeof en)['shareOfVoice']

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))

/**
 * Share of voice for the brand and each competitor (GEO parity Step 6).
 * Server-rendered: three tables and two links, no client state.
 */
export function ShareOfVoiceBenchmark({
  state, view, copy, lang, clientId,
}: {
  state: 'ok' | 'error'
  view: ShareOfVoiceView | null
  copy: Copy
  lang: string
  clientId: string
}) {
  const shareText = (cell: SovCell | undefined) =>
    cell && cell.share !== null ? fill(copy.share_value, { value: cell.share }) : copy.no_data
  const changeText = (subject: SovSubject) =>
    subject.change === null ? copy.change_none
      : subject.change > 0 ? fill(copy.change_up, { value: subject.change })
      : subject.change < 0 ? fill(copy.change_down, { value: Math.abs(subject.change) })
      : copy.change_flat
  const label = (subject: SovSubject) => subject.kind === 'brand' ? fill(copy.you, { name: subject.label }) : subject.label

  const latest = view?.weeks[0]
  const csvHref = `/api/dashboard/clients/${encodeURIComponent(clientId)}/share-of-voice?format=csv`

  return (
    <section aria-labelledby="share-of-voice-title" className="mt-8 space-y-4">
      <h2 id="share-of-voice-title" className="text-xl font-bold">{copy.title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{copy.intro}</p>

      {state === 'error' && <p role="alert" className="text-sm">{copy.error}</p>}
      {state === 'ok' && (!view || !latest) && <p className="text-sm text-muted-foreground">{copy.empty}</p>}

      {state === 'ok' && view && latest && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <caption className="mb-2 text-left font-semibold">{fill(copy.week, { week: latest })}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">{copy.col_brand}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{copy.col_share}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{copy.col_mentions}</th>
                  <th scope="col" className="py-2 font-medium">{copy.col_change}</th>
                </tr>
              </thead>
              <tbody>
                {view.subjects.map(subject => {
                  const cell = subject.cells[latest]?.[ALL_PLATFORMS]
                  return (
                    <tr key={`${subject.kind}-${subject.label}`} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-medium">
                        {label(subject)}
                        {subject.kind === 'other' && <span className="ml-2 text-xs font-normal text-muted-foreground">{copy.other}</span>}
                      </th>
                      <td className="py-2 pr-4 tabular-nums">{shareText(cell)}</td>
                      <td className="py-2 pr-4 tabular-nums">{cell ? fill(copy.mentions_value, { mentions: cell.mentions, answers: cell.answers }) : copy.no_data}</td>
                      <td className="py-2 tabular-nums">{changeText(subject)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {view.platforms.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <caption className="mb-2 text-left font-semibold">{copy.by_platform}</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">{copy.col_brand}</th>
                    {view.platforms.map(platform => <th key={platform} scope="col" className="py-2 pr-4 font-medium">{platform}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.subjects.map(subject => (
                    <tr key={`${subject.kind}-${subject.label}`} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-medium">{label(subject)}</th>
                      {view.platforms.map(platform => (
                        <td key={platform} className="py-2 pr-4 tabular-nums">{shareText(subject.cells[latest]?.[platform])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view.prompts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <caption className="mb-2 text-left font-semibold">{copy.by_question}</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">{copy.col_question}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{copy.col_answers}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{copy.col_you}</th>
                    <th scope="col" className="py-2 font-medium">{copy.col_competitors}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.prompts.map(prompt => (
                    <tr key={prompt.promptId ?? prompt.question} className="border-b align-top last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">{prompt.question}</th>
                      <td className="py-2 pr-4 tabular-nums">{prompt.answers}</td>
                      <td className="py-2 pr-4 tabular-nums">{prompt.brandMentions}</td>
                      <td className="py-2">
                        {prompt.competitors.length
                          ? prompt.competitors.map(c => `${c.label} (${c.mentions})`).join(', ')
                          : copy.none}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-4">
        {state === 'ok' && latest && (
          <a href={csvHref} download className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">{copy.download}</a>
        )}
        <Link href={`/${lang}/dashboard/${clientId}/competitors`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">
          {copy.manage}
        </Link>
      </div>
    </section>
  )
}
