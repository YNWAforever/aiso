import { SampleReport } from '@/components/reports/SampleReport'
import { buildLocalizedMetadata } from '@/lib/seo'
type Props = { params: Promise<{ lang: string }> }
export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/sample-report')
}
export default async function Page({ params }: Props) {
  const { lang } = await params
  return <SampleReport lang={lang}/>
}
