import { notFound }        from 'next/navigation'
import { supabase }         from '@/lib/supabase'
import { ResultClient }     from '@/components/result/ResultClient'
import type { Scan }        from '@/lib/types'

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
