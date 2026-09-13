import type { ActivationProgress as Progress } from '@/lib/view-models/activation-progress'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * The derived activation funnel, shown to the owner it describes.
 *
 * The unavailable state is not a loading skeleton and not an empty list: it is
 * a sentence saying the progress could not be read. `readActivation` throws
 * rather than returning nulls so that a database incident and an account that
 * has done nothing stay distinguishable, and rendering a "0" for the first
 * would throw that away on the last step of the journey.
 */
export function ActivationProgress({ progress, lang }: { progress: Progress; lang: string }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).activation
  const label = (key: keyof typeof copy.milestones) => copy.milestones[key]

  return (
    <section aria-labelledby="activation-progress">
      <h2 id="activation-progress" className="mb-4 text-lg font-bold text-foreground">{copy.title}</h2>
      {progress.state === 'unavailable' ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{copy.unavailable}</p>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-semibold text-foreground">
            {copy.progress}: {progress.reached} / {progress.total}
          </p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {progress.milestones.map(milestone => (
              <li
                key={milestone.key}
                className={`flex min-h-11 items-center gap-2 text-sm ${milestone.counted ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <span aria-hidden="true">{milestone.counted ? '✓' : '·'}</span>
                <span>{label(milestone.key)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-muted-foreground">
            {progress.next === null ? copy.complete : `${copy.next}: ${label(progress.next)}`}
          </p>
          {progress.outOfOrder.length > 0 && (
            // Reached, but ahead of a step with no record behind it. Counting it
            // would describe a funnel nobody walked; leaving it out entirely
            // would make this panel contradict the rows it is derived from.
            <p className="mt-2 text-sm text-muted-foreground">
              {copy.outOfOrder}: {progress.outOfOrder.map(label).join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
