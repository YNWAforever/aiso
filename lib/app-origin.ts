/**
 * The single source of the app's public origin.
 *
 * Three modules used to fall back to three *different* hosts when
 * NEXT_PUBLIC_APP_URL was unset — lib/seo.ts to fimmick-aeo-oitb.vercel.app,
 * lib/stripe.ts to fimmick-aeo.vercel.app, lib/reports/service.ts to
 * aeo.fimmick.com. An unconfigured deploy therefore emitted SEO canonicals for
 * one domain, bounced Stripe customers to a second, and minted signed report
 * share links on a third.
 *
 * Deliberately a plain module rather than living in lib/seo.ts: lib/stripe.ts
 * has no business importing the metadata layer to learn its own redirect host.
 */

// The report/share host — the only real domain of the three, and the one an
// external recipient of a share link actually sees.
export const DEFAULT_APP_ORIGIN = 'https://aeo.fimmick.com'

/**
 * `?.trim() ||`, not `??`. Nullish coalescing falls back only on null and
 * undefined -- not on '', which is what Vercel and GitHub Actions substitute
 * for a variable that is declared but has no value. That is not hypothetical:
 * on 2026-09-01 a Vercel preview build failed with
 * `TypeError: Invalid URL { input: '' }` while "Collecting page data", because
 * lib/seo.ts evaluates `new URL(appOrigin())` at module scope and got ''. The
 * GitHub Actions build job passed at the same commit, so the gap was invisible
 * until a second builder ran with a differently-configured environment.
 *
 * Trimming as well as emptiness-checking: a variable pasted with a stray space
 * is the same class of accident and produces the same crash.
 */
export function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_ORIGIN
}
