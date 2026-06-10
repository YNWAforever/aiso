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
  const { id } = await params
  const { data: scan } = await supabase
    .from('scans')
    .select('domain, score, grade')
    .eq('id', id)
    .single()

  if (!scan) return { title: 'AI Visibility Scan — Fimmick AISO' }

  const title = `${scan.domain} scored ${Math.round(scan.score)}/100 (${scan.grade ?? 'F'}) on AI visibility`
  const description = `See how visible ${scan.domain} is to ChatGPT, Perplexity, Claude and Gemini — 20-check AI readiness scan by Fimmick AISO.`
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
