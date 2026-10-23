import Link from 'next/link'
import { Check } from 'lucide-react'
import { Illustration, type IllustrationName } from '@/components/ui/illustration'
import type { GettingStarted as Model, GettingStartedKey } from '@/lib/view-models/getting-started'
import { cn } from '@/lib/utils'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

const ILLUSTRATION: Record<GettingStartedKey, IllustrationName> = { brand: 'brand', scan: 'scan', fixes: 'fixes', questions: 'questions' }

/**
 * The first-run checklist: four steps, one illustration and one sentence each,
 * and one button on the current step only. The progress bar fills and the
 * steps rise in once, on reveal (transform and opacity, CSS only); reduced
 * motion and no-JS show the finished state.
 */
export function GettingStarted({ model, lang, base }: { model: NonNullable<Model>; lang: string; base: string }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).workspaceHome.gettingStarted
  const href: Record<GettingStartedKey, string> = {
    brand: `${base}/entities`,
    scan: `${base}?step=scan`,
    fixes: `${base}/opportunities`,
    questions: `${base}/prompts`,
  }
  return (
    <section aria-labelledby="getting-started-heading" className="mb-8 rounded-2xl border border-dash-border bg-dash-surface p-5 shadow-sm sm:p-6" data-reveal data-testid="getting-started">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="getting-started-heading" className="text-lg font-bold text-dash-text">{copy.title}</h2>
        <p className="text-sm font-semibold tabular-nums text-dash-muted">{copy.progress.replace('{done}', String(model.done))}</p>
      </div>
      <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-4">
        <div className="reveal-bar h-full rounded-full bg-primary" style={{ ['--to' as string]: model.done / model.steps.length }} />
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {model.steps.map((step, index) => {
          const text = copy.steps[step.key]
          const done = step.state === 'done'
          const current = step.state === 'current'
          return (
            <li
              key={step.key}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'reveal-up flex flex-col gap-2 rounded-xl border p-4',
                current ? 'border-primary bg-primary/5' : 'border-dash-border',
              )}
              style={{ ['--reveal-delay' as string]: `${index * 60}ms` }}
            >
              <div className="flex items-center justify-between gap-2">
                <Illustration name={ILLUSTRATION[step.key]} className={cn('h-12 w-16', done && 'opacity-60')} />
                {done
                  ? <span className="reveal-pop inline-flex items-center gap-1 rounded-full bg-tone-success-soft px-2 py-0.5 text-xs font-semibold text-tone-success-fg"><Check aria-hidden="true" className="size-3.5" />{copy.done}</span>
                  : <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full border border-dash-border text-xs font-bold tabular-nums text-dash-muted">{index + 1}</span>}
              </div>
              <h3 className={cn('text-sm font-bold', done ? 'text-dash-muted' : 'text-dash-text')}>{text.title}</h3>
              <p className="text-sm text-dash-muted">{text.body}</p>
              {current && (
                <Link href={href[step.key]} className="mt-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  {text.cta}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
