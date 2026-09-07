import Link from 'next/link'
import { SAMPLE_REPORT } from '@/lib/reports/sample'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/** Pure static sample: no report resolver, view counter, authentication or provider calls. */
export function SampleReport({ lang }: { lang: string }) {
  const copy = (lang === 'zh-HK' ? zhHK : en).sampleReport
  return <div className="mx-auto max-w-5xl space-y-10 px-4 py-12 sm:px-6 sm:py-16">
    <div><p className="text-sm font-semibold text-primary-accessible">{copy.eyebrow}</p><h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{copy.title}</h1><p className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground">{copy.intro}</p></div>
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8"><h2 className="text-xl font-semibold">{copy.brand}</h2><p className="mt-2 text-sm text-muted-foreground">{SAMPLE_REPORT.domain}</p><dl className="mt-6 grid gap-5 sm:grid-cols-3"><div><dt className="text-sm text-muted-foreground">{copy.score}</dt><dd className="mt-2 text-3xl font-bold">{SAMPLE_REPORT.score} / 100</dd></div><div><dt className="text-sm text-muted-foreground">{copy.grade}</dt><dd className="mt-2 text-3xl font-bold">{SAMPLE_REPORT.grade}</dd></div><div><dt className="text-sm text-muted-foreground">{copy.date}</dt><dd className="mt-2"><time dateTime={SAMPLE_REPORT.observedAt}>{SAMPLE_REPORT.observedAt}</time></dd></div></dl></section>
    <section><h2 className="text-2xl font-semibold">{copy.checks}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.subset}</p><ul className="mt-5 grid gap-4 sm:grid-cols-3">{SAMPLE_REPORT.checks.map(check=><li key={check.key} className="rounded-xl border border-border bg-card p-5"><h3 className="font-semibold">{copy[check.key]}</h3><p className="mt-2 text-sm font-semibold">{copy[check.status]}</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy[`${check.key}Body`]}</p></li>)}</ul></section>
    <section className="rounded-xl border border-border p-6"><h2 className="text-xl font-semibold">{copy.work}</h2><p className="mt-3 leading-relaxed">{copy.workBody}</p><p className="mt-3 text-sm text-muted-foreground">{copy.draftOnly}</p></section>
    <div className="grid gap-6 sm:grid-cols-2">{(['comparison','limits'] as const).map(key=><section key={key}><h2 className="text-xl font-semibold">{copy[key]}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy[`${key}Body`]}</p></section>)}</div>
    <nav aria-label={copy.title} className="flex flex-wrap gap-4"><Link href={`/${lang}/scan`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">{copy.scan}</Link><Link href={`/${lang}/methodology`} className="inline-flex min-h-11 items-center px-3 text-primary-accessible underline underline-offset-4">{copy.methodology}</Link></nav>
  </div>
}
