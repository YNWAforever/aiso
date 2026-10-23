import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Illustration, type IllustrationName } from '@/components/ui/illustration'

/**
 * The page's one focal action: a caption, an optional sentence, one button.
 * Lives in the page header so "one useful header action" stays true.
 */
export function NextActionCard({ caption, sentence, detail, href, cta, illustration }: {
  caption: string
  sentence?: string
  detail?: string
  href: string
  cta: string
  illustration: IllustrationName
}) {
  return (
    <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center" data-testid="next-action">
      <Illustration name={illustration} className="h-14 w-20 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-accessible">{caption}</p>
        {sentence && <p className="mt-1 font-semibold text-dash-text">{sentence}</p>}
        {detail && <p className="mt-0.5 text-sm text-dash-muted">{detail}</p>}
      </div>
      <Link
        href={href}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {cta}<ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  )
}
