import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export type PublicPageCopy = {
  title: string
  summary: string
  actions: string[]
  evidence: string
  limitations: string
}

/** Server-only presentation. Routes choose their own copy and related destinations. */
export async function PublicInformationPage({ lang, copy, planned = false, related = [] }: {
  lang: string
  copy: PublicPageCopy
  planned?: boolean
  related?: { href: string; label: string }[]
}) {
  const t = await getTranslations({ locale: lang, namespace: 'publicPages.common' })
  return (
    <div className="mx-auto max-w-6xl break-words px-4 py-12 sm:px-6 sm:py-20">
      <section className="max-w-3xl" aria-labelledby="page-title">
        <p className="mb-4 text-sm font-semibold text-primary">{planned ? t('planned') : t('eyebrow')}</p>
        <h1 id="page-title" className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{copy.title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{copy.summary}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/${lang}#scan`} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">{t('scan')}</Link>
          {!planned && <Link href={`/${lang}/auth/login`} className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 py-3 font-semibold">{t('signIn')}</Link>}
        </div>
      </section>
      <div className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold">{planned ? t('proposed') : t('actions')}</h2>
          <ol className="mt-6 space-y-5">
            {copy.actions.map((action, index) => <li key={action} className="flex gap-4 leading-relaxed"><span aria-hidden="true" className="font-mono font-semibold text-primary">0{index + 1}</span><span>{action}</span></li>)}
          </ol>
        </section>
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><h2 className="text-xl font-semibold">{t('evidence')}</h2><p className="mt-4 leading-relaxed text-muted-foreground">{copy.evidence}</p></section>
          <section className="rounded-2xl border border-border p-6 sm:p-8"><h2 className="text-xl font-semibold">{t('limitations')}</h2><p className="mt-4 leading-relaxed text-muted-foreground">{copy.limitations}</p></section>
        </div>
      </div>
      {related.length > 0 && <section className="mt-12 border-t border-border pt-8"><h2 className="text-xl font-semibold">{t('related')}</h2><ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">{related.map(link => <li key={link.href}><Link href={`/${lang}${link.href}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">{link.label}</Link></li>)}</ul></section>}
    </div>
  )
}
