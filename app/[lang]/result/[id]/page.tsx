import { notFound }        from 'next/navigation'
import { supabase }         from '@/lib/supabase'
import { ResultClient }     from '@/components/result/ResultClient'
import type { Scan }        from '@/lib/types'
import type { Metadata }    from 'next'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}): Promise<Metadata> {
  const { lang, id } = await params
  const isZh = lang === 'zh-HK'
  const { data: scan } = await supabase
    .from('scans')
    .select('domain, score, grade')
    .eq('id', id)
    .single()

  if (!scan) {
    return { title: isZh ? 'AI 可見度掃描 — Fimmick AISO' : 'AI Visibility Scan — Fimmick AISO' }
  }

  const score = Math.round(scan.score)
  const grade = scan.grade ?? 'F'
  const title = isZh
    ? `${scan.domain} 的 AI 可見度得分 ${score}/100（${grade}）`
    : `${scan.domain} scored ${score}/100 (${grade}) on AI visibility`
  const description = isZh
    ? `查看 ${scan.domain} 在 ChatGPT、Perplexity、Claude 及 Gemini 的可見度——由 Fimmick AISO 提供的 20 項 AI 就緒檢查。`
    : `See how visible ${scan.domain} is to ChatGPT, Perplexity, Claude and Gemini — 20-check AI readiness scan by Fimmick AISO.`
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}) {
  const { lang, id } = await params

  const { data: scan } = await supabase
    .from('scans')
    .select('*')
    .eq('id', id)
    .single()

  if (!scan) notFound()

  return <ResultClient scan={scan as Scan} lang={lang} />
}
