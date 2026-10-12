import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const metadata = { robots: { index: false, follow: false } }

/** Synthetic error-boundary acceptance only. No data, Auth or provider operations. */
export default async function AuditErrorFixture({ params }: { params: Promise<{ lang: string }> }) {
  if (process.env.E2E_FIXTURE_MODE !== '1') notFound()
  const store = await cookies()
  if (store.get('aiso-audit-fixture-failure')?.value === 'fail') throw new Error('synthetic-private-error-marker')
  const { lang } = await params
  return <main><h1>{lang === 'zh-HK' ? '已恢復測試頁面' : 'Fixture page recovered'}</h1><Link href={'/'+lang}>{lang === 'zh-HK' ? '返回首頁' : 'Back to home'}</Link></main>
}
