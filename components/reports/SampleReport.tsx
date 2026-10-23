import Link from 'next/link'
import { sampleReportSnapshot } from '@/lib/reports/sample'
import { OnePageReport } from './OnePageReport'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/** Pure static sample: no report resolver, view counter, authentication or provider calls. */
export function SampleReport({ lang }: { lang: string }) {
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const copy = (locale === 'zh-HK' ? zhHK : en).sampleReport
  const snapshot = sampleReportSnapshot(locale, { agency: copy.agency, brand: copy.brand, summary: copy.summary, method: copy.method })
  return <div className="mx-auto max-w-5xl space-y-10 px-4 py-12 sm:px-6 sm:py-16 print:space-y-0 print:p-0">
    <div className="print:hidden"><p className="text-sm font-semibold text-primary-accessible">{copy.eyebrow}</p><h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{copy.title}</h1><p className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground">{copy.intro}</p></div>
    <OnePageReport variant="embedded" printable snapshot={snapshot} />
    <p className="text-sm text-muted-foreground print:hidden">{copy.draftOnly}</p>
    <div className="grid gap-6 sm:grid-cols-2 print:hidden">{(['comparison','limits'] as const).map(key=><section key={key}><h2 className="text-xl font-semibold">{copy[key]}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy[`${key}Body`]}</p></section>)}</div>
    <nav aria-label={copy.title} className="flex flex-wrap gap-4 print:hidden"><Link href={`/${lang}/scan`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">{copy.scan}</Link><Link href={`/${lang}/methodology`} className="inline-flex min-h-11 items-center px-3 text-primary-accessible underline underline-offset-4">{copy.methodology}</Link></nav>
  </div>
}
