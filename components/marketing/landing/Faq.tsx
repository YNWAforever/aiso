import { ChevronDown } from 'lucide-react'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'

export interface FaqItem { q: string; a: string }

/** Native <details>: keyboard and screen-reader behaviour for free, no JS. */
export function Faq({ eyebrow, title, items }: { eyebrow: string; title: string; items: readonly FaqItem[] }) {
  return (
    <section aria-labelledby="faq-title" className="border-t border-border bg-neutral-2 py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <SectionHeading id="faq-title" eyebrow={eyebrow} title={title} />
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {items.map(({ q, a }) => (
            <details key={q} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {q}
                <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <p className="pb-5 text-sm text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
