import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { supabase }      from '@/lib/supabase'
import { ScoreRing }     from '@/components/ScoreRing'
import { CheckItem }     from '@/components/CheckItem'
import { FixPackClient } from '@/components/FixPackClient'
import type { Scan }     from '@/lib/types'

const CHECK_KEYS = ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] as const

export default async function ResultPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params
  const t = await getTranslations()

  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).single()
  if (!scan) notFound()

  const s = scan as Scan
  const scoreLabel = s.score >= 80 ? t('result.score_good') : s.score >= 50 ? t('result.score_ok') : t('result.score_bad')

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <Link href={`/${lang}`} className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </Link>
        <Link href={`/${lang === 'en' ? 'zh-HK' : 'en'}/result/${id}`} className="text-sm text-blue-600 hover:underline">
          {lang === 'en' ? '中文' : 'EN'}
        </Link>
      </nav>

      <main className="max-w-xl mx-auto px-6 py-10">
        {/* Score card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 flex items-center gap-5">
          <ScoreRing score={s.score} />
          <div>
            <p className="text-lg font-bold text-slate-900">{s.domain}</p>
            <p className="text-sm text-slate-500">{t('result.score_label')} — {scoreLabel}</p>
          </div>
        </div>

        {/* Checks */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <p className="text-xs font-bold text-slate-500 tracking-widest mb-4">{t('result.checks_title')}</p>
          {CHECK_KEYS.map(key => (
            <CheckItem
              key={key}
              label={t(`checks.${key}`)}
              result={s.results[key]}
              message={t(`checks.${s.results[key].message}`)}
            />
          ))}
        </div>

        {/* Fix Pack */}
        <FixPackClient
          scanId={s.id}
          fixCta={t('result.fix_cta')}
          fixSubtitle={t('result.fix_subtitle')}
          copyLabel={t('result.copy')}
          copiedLabel={t('result.copied')}
        />
      </main>
    </div>
  )
}
