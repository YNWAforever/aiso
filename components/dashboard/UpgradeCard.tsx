import { Illustration } from '@/components/ui/illustration'

/**
 * An in-context upgrade prompt: shown where a plan limit stopped the user,
 * with one sentence of why and one button. No hooks, so client and server
 * components can both render it; the caller passes translated strings. A plain
 * anchor, not next/link: pricing is a full page change, and the card also
 * renders in standalone component bundles that have no Next router.
 */
export function UpgradeCard({ title, body, cta, href, testId = 'upgrade-card' }: { title: string; body: string; cta: string; href: string; testId?: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center" data-testid={testId}>
      <Illustration name="upgrade" className="h-14 w-20 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
      </div>
      <a href={href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {cta}
      </a>
    </div>
  )
}
