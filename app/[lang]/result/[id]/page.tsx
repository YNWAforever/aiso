import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { supabase }        from '@/lib/supabase'
import { getProfile }      from '@/lib/auth'
import { ScoreRing }       from '@/components/ScoreRing'
import { CheckItem }       from '@/components/CheckItem'
import { FixPackClient }   from '@/components/FixPackClient'
import { SaveScanButton }  from '@/components/SaveScanButton'
import type { Scan }       from '@/lib/types'

const CHECK_KEYS = ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] as const

export default async function ResultPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params
  const t = await getTranslations()

  const [{ data: scan }, profile] = await Promise.all([
    supabase.from('scans').select('*').eq('id', id).single(),
    getProfile(),
  ])
  if (!scan) notFound()

  const s = scan as Scan
  const scoreLabel = s.score >= 80 ? t('result.score_good') : s.score >= 50 ? t('result.score_ok') : t('result.score_bad')
  // Show "Save" button when user is logged in and this scan isn't already theirs
  const canSave = profile && (!s.account_id || s.account_id !== profile.account_id)

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <Link href={`/${lang}`} className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </Link>
        <div className="flex items-center gap-4">
          {canSave ? (
            <SaveScanButton scanId={s.id} lang={lang} />
          ) : profile ? (
            <Link href={`/${lang}/dashboard`} className="text-sm text-slate-500 hover:text-slate-900 transition">
              Dashboard
            </Link>
          ) : (
            <Link href={`/${lang}/auth/login`} className="text-sm text-slate-500 hover:text-slate-900 transition">
              {t('nav.sign_in')}
            </Link>
          )}
          <Link
            href={`/${lang}/pricing`}
            className="text-sm font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition"
          >
            {t('nav.get_started')}
          </Link>
          <Link href={`/${lang === 'en' ? 'zh-HK' : 'en'}/result/${id}`} className="text-sm text-blue-600 hover:underline">
            {lang === 'en' ? '中文' : 'EN'}
          </Link>
        </div>
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

        {/* Post-scan upsell */}
        <div className="bg-slate-900 rounded-xl p-7 mt-6 text-center">
          <p className="text-2xl">📊</p>
          <h2 className="text-white font-black text-lg mt-2">
            {t('upsell.title', { domain: s.domain })}
          </h2>
          <p className="text-slate-400 text-sm mt-2 max-w-xs mx-auto">
            {t('upsell.body')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
            <Link
              href={`/${lang}/auth/login`}
              className="bg-blue-600 text-white font-semibold px-6 py-2.5 rounded-lg text-sm hover:bg-blue-700 transition"
            >
              {t('upsell.cta_primary')}
            </Link>
            <Link
              href={`/${lang}/pricing`}
              className="bg-slate-700 text-white font-semibold px-6 py-2.5 rounded-lg text-sm hover:bg-slate-600 transition"
            >
              {t('upsell.cta_secondary')}
            </Link>
          </div>
          <p className="mt-4">
            <Link href={`/${lang}/auth/login`} className="text-slate-500 text-xs hover:text-slate-300 transition">
              {t('upsell.sign_in')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
