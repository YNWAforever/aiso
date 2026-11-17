import { NextIntlClientProvider } from 'next-intl'
import { ScanPicker } from '@/components/dashboard/ScanPicker'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { ReportBuilder } from '@/components/reports/ReportBuilder'
import LogoutPage from '@/app/[lang]/auth/logout/page'
import { buildDashboardNav, type NavItem } from '@/lib/dashboard-nav'
import { safeReturnTo } from '@/lib/auth-return-to'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { sampleReportSnapshot } from '@/lib/reports/sample'
import type { Scan } from '@/lib/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

export const fixtureBrand = '11111111-1111-4111-8111-111111111111'
export const fixtureScans = [
  { id: 'latest-scan', score: 70, created_at: '2026-10-20T08:00:00.000Z' },
  { id: 'older-scan', score: 52, created_at: '2026-10-01T08:00:00.000Z' },
].map(scan => ({ ...scan, account_id: 'synthetic-account', url: 'https://example.invalid/guide', domain: 'example.invalid', industry: 'technology', region: 'HK', grade: 'C', results: {} } as Scan))

/** Presentation-only fixture: real components, synthetic navigation and API boundaries. */
export function PostLoginScanFixture({ href }: { href: string }) {
  const url = new URL(href)
  const lang = url.pathname.startsWith('/zh-HK/') ? 'zh-HK' : 'en'
  const base = `/${lang}/dashboard/${fixtureBrand}`
  const selected = url.searchParams.get('scanId')
  const scan = fixtureScans.find(item => item.id === selected) ?? fixtureScans[0]!
  const features = resolveCommercialEntitlement({ plan: 'pro', status: 'active', stripe_subscription_id: 'synthetic-subscription' }).features
  const step = url.searchParams.get('step') ?? 'results'
  const improveReceipt = {
    version: 1, producer: 'native-improve.v1', token: 'fixture-token', state: 'complete' as const,
    fingerprint: 'fixture-fingerprint', startedAt: '2026-10-20T08:00:00Z', leaseUntil: '2026-10-20T08:01:00Z', providerStarted: true,
    outcomes: { recommendations: 'available' as const, progress: 'unavailable' as const, competitors: 'unavailable' as const },
    counts: { recommendations: 1, progress: 0, competitors: 0 },
    reasons: { progress: 'no-classified-observations', competitors: 'no-sourced-competitor-evidence' },
    sourceCheckIds: ['c1_robots'],
    recommendationBasis: [{ checkId: 'c1_robots', assessment: 'fail' as const, action: 'Review the saved crawler access check.',
      source: { scanId: scan.id, checkId: 'c1_robots' }, limitations: ['no-page-or-provider-excerpts'] }],
  }
  const improveScan = step === 'improve' ? { ...scan, results: { ...scan.results, _agent_generation: improveReceipt } } : scan
  const recommendations = step === 'improve'
    ? [{ id: 'fixture-recommendation', scan_id: scan.id, platform: 'gpt4o', category: 'content', priority: 'high' as const,
      recommendation: 'Synthetic saved review action.', impact_score: 4, created_at: '2026-10-20T08:00:00Z' }]
    : []
  const nav = buildDashboardNav({ lang, clientId: fixtureBrand, features, scanId: selected })
  const copy = lang === 'en' ? en : zh
  return <NextIntlClientProvider locale={lang} timeZone="UTC" messages={copy}>
    <main className="mx-auto max-w-3xl p-4">
      <h1>Post-login component fixture</h1>
      {url.pathname.endsWith('/auth/logout') ? <LogoutPage /> : url.pathname.endsWith('/auth/login') ?
        <a href={safeReturnTo(url.searchParams.get('next'), lang)}>Synthetic sign-in continuation</a> : <>
          <nav aria-label="Fixture workspace">{nav.filter(item => ['scan', 'reports'].includes(item.key)).flatMap<NavItem>(item => item.items.length ? item.items : [item]).map(item => <a key={item.key} href={item.href} className="mr-4 inline-flex min-h-11 items-center">{copy.dashboard[item.labelKey as keyof typeof copy.dashboard] as string}</a>)}
            <a href={`/${lang}/auth/logout?next=${encodeURIComponent(url.pathname + url.search)}`}>Fixture sign out</a>
          </nav>
          {url.pathname.includes('/reports') ? <>
            <ScanPicker lang={lang} action={`${base}/reports/new`} scans={fixtureScans} selectedScanId={selected} />
            {selected && <ReportBuilder key={selected} lang={lang} clientId={fixtureBrand} scanId={scan.id} initialReport={null}
              initialSnapshot={sampleReportSnapshot(lang, { agency: 'Synthetic agency', brand: 'Synthetic brand', summary: 'Synthetic saved scan summary.', method: 'Synthetic evidence only.' })} />}
          </> : step === 'scan' ? <ScanStep lang={lang} clientId={fixtureBrand} scan={scan} scanHistory={fixtureScans} /> : step === 'improve' ?
            <ImproveStep scan={improveScan} features={features} recommendations={recommendations} progress={[]} competitors={[]} scanChoices={fixtureScans} /> : <>
              <ScanPicker lang={lang} action={base} step="results" scans={fixtureScans} selectedScanId={scan.id} />
              <ResultsStep scan={scan} lang={lang} clientId={fixtureBrand} />
            </>}
        </>}
    </main>
  </NextIntlClientProvider>
}
