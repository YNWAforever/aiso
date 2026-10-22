import { useTranslations } from 'next-intl'
import { ScanForm } from '@/components/home/ScanForm'

export function FinalCta({ lang }: { lang: string }) {
  const t = useTranslations('landing.final')
  return (
    <section id="scan-again" aria-labelledby="final-title" className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-3xl rounded-3xl border border-primary/20 bg-card p-5 shadow-e2 sm:px-10 sm:pb-6 sm:pt-10">
        <h2 id="final-title" className="text-balance text-center text-3xl font-black tracking-tight text-foreground sm:text-4xl">{t('title')}</h2>
        <p className="mt-3 text-center text-muted-foreground">{t('subtitle')}</p>
        <div className="mx-auto mt-8 max-w-xl"><ScanForm lang={lang} /></div>
      </div>
    </section>
  )
}
