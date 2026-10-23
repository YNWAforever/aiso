import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { OnePageReport } from '@/components/reports/OnePageReport'
import { resolvePublishedClientReport } from '@/lib/reports/public'
import { incrementClientReportView } from '@/lib/reports/store'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

type PublicReportPageProps = {
  params: Promise<{ lang: string; slug: string }>
  searchParams: Promise<{ v?: string | string[]; s?: string | string[] }>
}

export const dynamic = 'force-dynamic'

function reportLocale(value: string): 'en' | 'zh-HK' {
  return value === 'zh-HK' ? 'zh-HK' : 'en'
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicReportPageProps): Promise<Metadata> {
  const [{ lang }] = await Promise.all([params, searchParams])
  return {
    title: (reportLocale(lang) === 'zh-HK' ? zhHK : en).reportPage.meta_title,
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  }
}

export default async function PublicReportPage({
  params,
  searchParams,
}: PublicReportPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const resolved = await resolvePublishedClientReport({
    slug,
    version: query.v,
    signature: query.s,
  })
  if (!resolved) notFound()

  try {
    await incrementClientReportView({
      publicSlug: slug,
      shareVersion: Number(query.v),
    })
  } catch {
    // Aggregate engagement is best-effort and must never block a valid report.
  }

  const { report, publishedAt, logoProxyUrl, contactProxyUrl } = resolved.dto

  return (
    <main className="min-h-dvh w-full overflow-x-clip bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
      <OnePageReport
        variant="page"
        printable
        snapshot={report}
        publishedAt={publishedAt}
        logoProxyUrl={logoProxyUrl}
        contactProxyUrl={contactProxyUrl}
      />
    </main>
  )
}
