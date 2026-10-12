import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

/**
 * The body shared by the 404 and error pages: a centred card on the same
 * dot-grid backdrop as the marketing hero, with one primary and one secondary
 * recovery action. Kept presentational so the server 404 and the client error
 * boundary can both render it.
 */
export function StatusPage({
  code,
  eyebrow,
  title,
  body,
  primary,
  secondary,
  children,
}: {
  code: string
  eyebrow: string
  title: string
  body: string
  primary: { href?: string; label: string; onClick?: () => void }
  secondary: { href: string; label: string }
  children?: ReactNode
}) {
  const primaryClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-accessible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const secondaryClass =
    'inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

  return (
    <section className="relative isolate overflow-hidden px-4 py-20 sm:px-6 sm:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle,color-mix(in_oklab,var(--foreground)_12%,transparent)_1px,transparent_1.5px)] bg-[length:20px_20px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div className="mx-auto max-w-xl text-center">
        <p aria-hidden="true" className="bg-gradient-to-b from-primary to-primary/30 bg-clip-text text-7xl font-black tracking-tighter text-transparent sm:text-8xl">
          {code}
        </p>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-primary-accessible">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground sm:text-4xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 text-muted-foreground">{body}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {primary.href ? (
            <Link href={primary.href} className={primaryClass}>
              {primary.label}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <button type="button" onClick={primary.onClick} className={primaryClass}>
              {primary.label}
            </button>
          )}
          <Link href={secondary.href} className={secondaryClass}>
            {secondary.label}
          </Link>
        </div>
        {children}
      </div>
    </section>
  )
}
