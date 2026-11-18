import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

/**
 * The one "this did not load" state for server-rendered dashboard pages: what
 * happened, that nothing was lost, and a way on (try again, or go back).
 */
export async function LoadError({ title, body, retryHref, backHref }: { title: string; body: string; retryHref: string; backHref?: string }) {
  const t = await getTranslations('dashboard.states')
  return <main role="alert" className="mx-auto w-full max-w-xl px-6 py-16 text-center">
    <h1 className="mb-2 text-lg font-bold text-foreground">{title}</h1>
    <p className="text-sm text-muted-foreground">{body}</p>
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Link href={retryHref} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{t('retry')}</Link>
      {backHref && <Link href={backHref} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{t('backToBrands')}</Link>}
    </div>
  </main>
}
