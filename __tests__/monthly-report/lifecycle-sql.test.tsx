import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ACCOUNT, OTHER_ACCOUNT, MEMBER, CLIENT, FOREIGN_CLIENT, SECOND_CLIENT, ITEM, VERSION, reportDatabase } from './sql-fixture'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const h = vi.hoisted(() => ({
  pg: null as PGlite | null, accountId: '', fail: false,
  beforePublish: null as null | (() => Promise<void>),
  calls: [] as string[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: async () => ({
  id: '20000000-0000-4000-8000-000000000001', account_id: h.accountId,
  accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_fixture' },
}) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/lib/db', async () => {
  const { databaseFailure } = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return { db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    h.calls.push(text)
    if (h.fail) throw databaseFailure({ code: '08006', message: 'PRIVATE_DATABASE_SENTINEL' })
    if (text.includes('public.publish_client_report_latest') && h.beforePublish) {
      const hook = h.beforePublish
      h.beforePublish = null
      await hook()
    }
    try { return (await h.pg!.query(text, values)).rows } catch (error) { throw databaseFailure(error) }
  } }
})

import { GET, POST as SAVE } from '@/app/api/clients/[clientId]/months/[month]/report/route'
import { POST as PUBLISH } from '@/app/api/clients/[clientId]/months/[month]/report/publish/route'
import { POST as REVOKE } from '@/app/api/clients/[clientId]/months/[month]/report/revoke/route'
import PublicReportPage from '@/app/[lang]/r/[slug]/page'
import { loadMonthlyReport, appendMonthlyReport, publishMonthlyReport, revokeMonthlyReport } from '@/lib/monthly-report/store'
import { listClientReports, loadOwnedClientReport, resolvePublicClientReport } from '@/lib/reports/store'
import { resolvePublishedMonthlyReport } from '@/lib/monthly-report/public'
import { signReportShare } from '@/lib/reports/share'
import { buildMonthlyReportSnapshot } from '@/lib/monthly-report/snapshot'
import { readBrandMonth, readMonthPulseWeeks } from '@/lib/brand-month/store'
import { loadOpenWorkItems } from '@/lib/monthly-report/store'
import { periodOf } from '@/lib/brand-month/period'
import { buildClientReportSnapshot } from '@/lib/reports/snapshot'
import { buildScanEvidence } from '@/lib/scan-evidence'

const ctx = (clientId = CLIENT) => ({ params: Promise.resolve({ clientId, month: '2026-10' }) })
const request = (body?: unknown) => new Request('http://localhost/fixture', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const save = (locale = 'en', narrative?: string, clientId = CLIENT) => SAVE(request({ locale, ...(narrative ? { narrative } : {}) }), ctx(clientId))
const publish = (versionId: string, clientId = CLIENT) => PUBLISH(request({ versionId }), ctx(clientId))
const load = () => loadMonthlyReport(ACCOUNT, CLIENT, '2026-10-01')
const q = async <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await h.pg!.query<T>(text, values)).rows
const linkInput = (link: string) => {
  const url = new URL(link)
  return { slug: url.pathname.split('/').at(-1)!, version: url.searchParams.get('v')!, signature: url.searchParams.get('s')! }
}
const publicPage = async (link: string, lang = 'en') => {
  const input = linkInput(link)
  const page = await PublicReportPage({
    params: Promise.resolve({ lang, slug: input.slug }),
    searchParams: Promise.resolve({ v: input.version, s: input.signature }),
  })
  return renderToStaticMarkup(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{page}</NextIntlClientProvider>)
}
const share = async () => {
  const response = await publish((await load())!.versionId)
  expect(response.status).toBe(200)
  return (await response.json()).shareUrl as string
}
const SIGNING_KEY = 'isolated-c2-test-signing-key-with-no-real-value'
const APP_URL = 'https://fixture.example'

beforeAll(async () => { h.pg = await reportDatabase() })
afterAll(async () => { await h.pg?.close() })
beforeEach(async () => {
  vi.stubEnv('REPORT_SHARE_SECRET', SIGNING_KEY)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL)
  h.accountId = ACCOUNT; h.fail = false; h.beforePublish = null; h.calls = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await h.pg!.exec(`truncate client_report_versions, client_reports cascade;
    truncate brand_month_snapshots, work_item_delivery_events, evidence_work_items cascade`)
})

describe('C2 isolated route + PostgreSQL lifecycle (simulated integration, no browser)', () => {
  it.each(['en', 'zh-HK'])('drafts stored evidence, publishes, reads without editing, and revokes in %s', async locale => {
    await q(`insert into evidence_work_items(id, account_id, client_id, title, operation_status, created_at)
      values ($1, $2, $3, 'Stored FAQ delivery', 'done', '2026-10-05')`, [ITEM, ACCOUNT, CLIENT])
    await q(`insert into work_item_delivery_events(account_id, client_id, work_item_id, version_id, kind, provenance, recorded_at)
      values ($1, $2, $3, $4, 'attest', 'verified_live', '2026-10-06T01:00:00Z')`, [ACCOUNT, CLIENT, ITEM, VERSION])
    const figures = { version: 1, scan: { state: 'none' }, pulse: { state: 'none' },
      search: { state: 'ok', from: '2026-09-03', through: '2026-09-30', days: 2, clicks: 17, impressions: 241 } }
    await q(`insert into brand_month_snapshots(account_id, client_id, month, kind, as_of, figures)
      values ($1, $2, '2026-10-01', 'opening', '2026-09-30T16:00:00Z', $3::jsonb)`, [ACCOUNT, CLIENT, JSON.stringify(figures)])
    expect((await save(locale)).status).toBe(201)
    const draft = (await load())!
    expect(draft.snapshot.delivered.verifiedLive).toEqual([{ title: 'Stored FAQ delivery', recordedAt: '2026-10-06T01:00:00.000Z', versionId: VERSION }])
    expect(draft.snapshot.delivered.selfReported).toEqual([])
    const [source] = await q<{ figures: typeof figures }>('select figures from brand_month_snapshots where account_id = $1 and client_id = $2', [ACCOUNT, CLIENT])
    expect(draft.snapshot.search.opening).toEqual(source.figures.search)
    expect(draft.snapshot.search.closing).toEqual({ state: 'not_recorded' })
    expect(draft.snapshot.visibility.state).toBe('not_enough_data')
    expect(draft.snapshot.executiveSummary).toContain(locale === 'en' ? '1 change verified live and 0 self-reported' : '\u5df2\u4e0a\u7dda\u6838\u5be6 1')
    const link = await share()
    expect(new URL(link).pathname).toMatch(new RegExp(`^/${locale}/r/`))
    const publicReport = (await resolvePublishedMonthlyReport(linkInput(link)))!
    expect(publicReport.report.search.opening).toEqual(source.figures.search)
    expect(publicReport.report.delivered.verifiedLive[0].versionId).toBe('0')
    const html = await publicPage(link, locale === 'en' ? 'zh-HK' : 'en')
    expect(html).toContain(`lang="${locale}"`)
    expect(html).toContain('Stored FAQ delivery')
    expect(html).toContain('241')
    expect(html).toContain(locale === 'en' ? 'Not recorded' : '\u672a\u8a18\u9304')
    for (const privateValue of [ACCOUNT, CLIENT, VERSION, draft.versionId, '<form', '<textarea', 'contenteditable', '/api/clients/']) {
      expect(html).not.toContain(privateValue)
    }
    const [stored] = await q('select published_version_id, latest_version_id, view_count::int as views from client_reports where account_id = $1', [ACCOUNT])
    expect(stored).toEqual({ published_version_id: draft.versionId, latest_version_id: draft.versionId, views: 1 })
    expect((await REVOKE(request(), ctx())).status).toBe(200)
    expect(await resolvePublishedMonthlyReport(linkInput(link))).toBeNull()
    await expect(publicPage(link)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('keeps scan rows in scan list/detail/public paths and monthly rows in monthly paths', async () => {
    expect((await save()).status).toBe(201)
    const monthly = (await load())!
    const [scan] = await q<{ id: string; public_slug: string }>(
      `insert into client_reports(account_id, client_id) values ($1, $2) returning id, public_slug`, [ACCOUNT, CLIENT])
    const scanSnapshot = buildClientReportSnapshot({
      locale: 'en', branding: monthly.snapshot.branding, client: monthly.snapshot.client,
      currentScan: { accountId: ACCOUNT, domain: 'bakery.example', score: 72, grade: 'B', createdAt: '2026-10-06T01:00:00.000Z',
        results: { evidence: buildScanEvidence({ requestedUrl: 'https://bakery.example', evaluatedUrl: 'https://bakery.example',
          industry: null, region: null, sitemapSource: null, checks: {},
          observations: [{ check: 'page', collection: 'complete', httpStatus: 200,
            target: { origin: 'https://bakery.example' }, provenance: 'validated-fetch' }] }) } },
      previousScan: null, recommendations: [],
    })
    const [version] = await q<{ id: string }>(`insert into client_report_versions(report_id, account_id, client_id,
      version_number, locale, executive_summary, snapshot_schema_version, snapshot)
      values ($1, $2, $3, 1, 'en', 'Unchanged scan fixture', 1, $4::jsonb) returning id`, [scan.id, ACCOUNT, CLIENT, JSON.stringify(scanSnapshot)])
    await q(`update client_reports set latest_version_id = $1, published_version_id = $1, status = 'published', published_at = now()
      where id = $2 and account_id = $3`, [version.id, scan.id, ACCOUNT])
    const scanLink = `https://fixture.example/en/r/${scan.public_slug}?v=1&s=${signReportShare({ slug: scan.public_slug, shareVersion: 1 })}`
    const scanHtml = await publicPage(scanLink)
    expect(scanHtml).toContain('72')
    const scanBefore = await resolvePublicClientReport({ publicSlug: scan.public_slug, shareVersion: 1 })
    const monthlyLink = await share()
    expect((await listClientReports({ accountId: ACCOUNT, clientId: CLIENT })).map(r => r.id)).toEqual([scan.id])
    expect(await loadOwnedClientReport({ accountId: ACCOUNT, clientId: CLIENT, reportId: monthly.reportId })).toBeNull()
    expect(await loadOwnedClientReport({ accountId: ACCOUNT, clientId: CLIENT, reportId: scan.id })).not.toBeNull()
    expect(await resolvePublicClientReport({ publicSlug: linkInput(monthlyLink).slug, shareVersion: 1 })).toBeNull()
    expect(await resolvePublicClientReport({ publicSlug: scan.public_slug, shareVersion: 1, kind: 'monthly' })).toBeNull()
    expect(await resolvePublishedMonthlyReport({ slug: scan.public_slug, version: '1',
      signature: signReportShare({ slug: scan.public_slug, shareVersion: 1 }) })).toBeNull()
    await REVOKE(request(), ctx())
    expect(await resolvePublicClientReport({ publicSlug: scan.public_slug, shareVersion: 1 })).toEqual(scanBefore)
    expect(await publicPage(scanLink)).toBe(scanHtml)
  })

  it('denies another account and another brand without changing the owned report', async () => {
    await save()
    const draft = (await load())!
    const before = await q('select to_jsonb(r) as row from client_reports r')
    h.accountId = OTHER_ACCOUNT
    for (const response of [await save(), await publish(draft.versionId), await REVOKE(request(), ctx())]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not found' })
    }
    expect((await (await GET(request(), ctx())).json()).report).toBeNull()
    h.accountId = ACCOUNT
    expect((await save('en', undefined, FOREIGN_CLIENT)).status).toBe(404)
    expect((await publish(draft.versionId, FOREIGN_CLIENT)).status).toBe(404)
    await expect(publishMonthlyReport({ accountId: OTHER_ACCOUNT, clientId: CLIENT, reportId: draft.reportId,
      reviewedVersionId: draft.versionId })).rejects.toThrow('CLIENT_REPORT_NOT_FOUND')
    await expect(revokeMonthlyReport({ accountId: OTHER_ACCOUNT, clientId: CLIENT, reportId: draft.reportId })).rejects.toThrow('CLIENT_REPORT_NOT_FOUND')
    expect(await q('select to_jsonb(r) as row from client_reports r')).toEqual(before)
  })

  it('isolates reads, publication and revocation between two brands in the same account', async () => {
    expect((await save('en', 'First brand public narrative.')).status).toBe(201)
    const first = (await load())!
    const firstLink = await share()
    const rows = () => q('select to_jsonb(r) as row from client_reports r where account_id = $1 order by client_id', [ACCOUNT])
    const firstPublished = await rows()
    expect(await loadMonthlyReport(ACCOUNT, SECOND_CLIENT, '2026-10-01')).toBeNull()
    const empty = await GET(request(), ctx(SECOND_CLIENT))
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ report: null })
    for (const response of [await publish(first.versionId, SECOND_CLIENT), await REVOKE(request(), ctx(SECOND_CLIENT))]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not found' })
    }
    expect(await rows()).toEqual(firstPublished)

    expect((await save('zh-HK', 'Second brand public narrative.', SECOND_CLIENT)).status).toBe(201)
    const second = (await loadMonthlyReport(ACCOUNT, SECOND_CLIENT, '2026-10-01'))!
    expect(second.reportId).not.toBe(first.reportId)
    const secondPublish = await publish(second.versionId, SECOND_CLIENT)
    expect(secondPublish.status).toBe(200)
    const secondLink = (await secondPublish.json()).shareUrl as string
    const before = await rows()
    const versionsBefore = await q('select to_jsonb(v) as row from client_report_versions v where account_id = $1 order by id', [ACCOUNT])
    for (const [clientId, wrongReport] of [[CLIENT, second], [SECOND_CLIENT, first]] as const) {
      const response = await publish(wrongReport.versionId, clientId)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'STALE_VERSION' })
      await expect(publishMonthlyReport({ accountId: ACCOUNT, clientId, reportId: wrongReport.reportId,
        reviewedVersionId: wrongReport.versionId })).rejects.toThrow('CLIENT_REPORT_NOT_FOUND')
      await expect(revokeMonthlyReport({ accountId: ACCOUNT, clientId, reportId: wrongReport.reportId }))
        .rejects.toThrow('CLIENT_REPORT_NOT_FOUND')
    }
    for (const [clientId, report, name, narrative] of [
      [CLIENT, first, 'Fixture Bakery', 'First brand public narrative.'],
      [SECOND_CLIENT, second, 'Second brand', 'Second brand public narrative.'],
    ] as const) {
      const response = await GET(request(), ctx(clientId))
      expect(response.status).toBe(200)
      expect((await response.json()).report).toMatchObject({ reportId: report.reportId,
        versionId: report.versionId, snapshot: { client: { name }, executiveSummary: narrative } })
    }
    expect(await rows()).toEqual(before)
    expect(await q('select to_jsonb(v) as row from client_report_versions v where account_id = $1 order by id', [ACCOUNT])).toEqual(versionsBefore)
    expect((await resolvePublishedMonthlyReport(linkInput(firstLink)))!.report.executiveSummary).toBe('First brand public narrative.')
    expect((await resolvePublishedMonthlyReport(linkInput(secondLink)))!.report.executiveSummary).toBe('Second brand public narrative.')
    expect((await REVOKE(request(), ctx(SECOND_CLIENT))).status).toBe(200)
    expect((await rows()).filter((r) => (r.row as { client_id: string }).client_id === CLIENT)).toEqual(firstPublished)
    expect(await resolvePublishedMonthlyReport(linkInput(secondLink))).toBeNull()
    expect((await resolvePublishedMonthlyReport(linkInput(firstLink)))!.report.executiveSummary).toBe('First brand public narrative.')
  })

  describe.each(['initial publish', 'republish'])('%s configuration failures', mode => {
    it.each([
      ['HTTP origin', 'NEXT_PUBLIC_APP_URL', 'http://fixture.example'],
      ['malformed origin', 'NEXT_PUBLIC_APP_URL', 'not-a-url'],
      ['credentialed origin', 'NEXT_PUBLIC_APP_URL', 'https://fixture:synthetic@fixture.example'],
      ['origin with path', 'NEXT_PUBLIC_APP_URL', 'https://fixture.example/path'],
      ['origin with query', 'NEXT_PUBLIC_APP_URL', 'https://fixture.example/?fixture=1'],
      ['origin with fragment', 'NEXT_PUBLIC_APP_URL', 'https://fixture.example/#fixture'],
      ['missing signing key', 'REPORT_SHARE_SECRET', undefined],
      ['empty signing key', 'REPORT_SHARE_SECRET', ''],
      ['short signing key', 'REPORT_SHARE_SECRET', 'k'.repeat(31)],
    ] as const)('leaves publication and public content unchanged with %s', async (_label, variable, value) => {
      expect((await save('en', 'Old public narrative.')).status).toBe(201)
      const first = (await load())!
      const oldLink = mode === 'republish' ? await share() : null
      const link = oldLink ?? `${APP_URL}/en/r/${first.publicSlug}?v=${first.shareVersion}&s=${signReportShare({
        slug: first.publicSlug, shareVersion: first.shareVersion,
      })}`
      if (oldLink) expect((await save('zh-HK', 'Replacement draft narrative.')).status).toBe(201)
      const reviewed = (await load())!
      const before = await q('select to_jsonb(r) as row from client_reports r where account_id = $1 and client_id = $2', [ACCOUNT, CLIENT])
      vi.stubEnv(variable, value)
      h.calls = []
      const response = await publish(reviewed.versionId)
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'MONTHLY_REPORT_UNAVAILABLE' })
      expect.soft(await q('select to_jsonb(r) as row from client_reports r where account_id = $1 and client_id = $2', [ACCOUNT, CLIENT])).toEqual(before)
      expect.soft(h.calls.some(text => text.includes('public.publish_client_report_latest'))).toBe(false)
      vi.stubEnv('REPORT_SHARE_SECRET', SIGNING_KEY)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL)
      const resolved = await resolvePublishedMonthlyReport(linkInput(link))
      if (oldLink) {
        expect.soft(resolved?.report.executiveSummary).toBe('Old public narrative.')
        const html = await publicPage(oldLink)
        expect.soft(html).toContain('Old public narrative.')
        expect.soft(html).not.toContain('Replacement draft narrative.')
      } else {
        expect.soft(resolved).toBeNull()
        await expect(publicPage(link)).rejects.toThrow('NEXT_NOT_FOUND')
      }
    })
  })

  it('captures valid URL and signing configuration before the publication mutation', async () => {
    expect((await save()).status).toBe(201)
    h.beforePublish = async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://fixture.example')
      vi.stubEnv('REPORT_SHARE_SECRET', 'short-fixture-key')
    }
    const response = await publish((await load())!.versionId)
    expect(response.status).toBe(200)
    const { shareUrl } = await response.json()
    expect(new URL(shareUrl).origin).toBe(APP_URL)
    vi.stubEnv('REPORT_SHARE_SECRET', SIGNING_KEY)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL)
    expect((await resolvePublishedMonthlyReport(linkInput(shareUrl)))!.report.executiveSummary).toBe((await load())!.snapshot.executiveSummary)
  })

  it('signs the authoritative slug and generation after a revoke between publish read and mutation', async () => {
    expect((await save('en', 'Previously published narrative.')).status).toBe(201)
    const oldLink = await share()
    expect((await save('zh-HK', 'Reviewed replacement narrative.')).status).toBe(201)
    const reviewed = (await load())!
    h.beforePublish = async () => { expect((await REVOKE(request(), ctx())).status).toBe(200) }
    const response = await publish(reviewed.versionId)
    expect(response.status).toBe(200)
    const { shareUrl } = await response.json()
    const published = (await load())!
    expect(published.shareVersion).toBe(reviewed.shareVersion + 2)
    expect(published.publicSlug).not.toBe(reviewed.publicSlug)
    expect(linkInput(shareUrl)).toMatchObject({ slug: published.publicSlug, version: String(published.shareVersion) })
    expect(new URL(shareUrl).pathname).toBe(`/zh-HK/r/${published.publicSlug}`)
    expect((await resolvePublishedMonthlyReport(linkInput(shareUrl)))!.report.executiveSummary).toBe('Reviewed replacement narrative.')
    expect(await resolvePublishedMonthlyReport(linkInput(oldLink))).toBeNull()
  })

  it('publishes only the explicitly reviewed version and returns 409 for a superseded review', async () => {
    await save('en', 'First reviewed draft.')
    const first = (await load())!
    await save('zh-HK', 'Second reviewed draft.')
    const latest = (await load())!
    const response = await publish(first.versionId)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'STALE_VERSION' })
    expect((await load())!.status).toBe('draft')
    const link = await share()
    expect((await load())!.publishedVersionId).toBe(latest.versionId)
    expect((await resolvePublishedMonthlyReport(linkInput(link)))!.report.executiveSummary).toBe('Second reviewed draft.')
    await save('en', 'Unpublished later draft.')
    expect((await resolvePublishedMonthlyReport(linkInput(link)))!.report.executiveSummary).toBe('Second reviewed draft.')
  })

  it('rechecks a save that lands between the publish read and the actual 027 RPC', async () => {
    await save('en', 'Reviewed.')
    const reviewed = (await load())!
    h.beforePublish = async () => {
      expect((await save('zh-HK', 'Concurrent saved draft.')).status).toBe(201)
    }
    const response = await publish(reviewed.versionId)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'STALE_VERSION' })
    expect((await load())!.publishedVersionId).toBeNull()
    expect((await load())!.snapshot.executiveSummary).toBe('Concurrent saved draft.')
  })

  it('serializes two queued saves and never moves the published pointer to an unreviewed version', async () => {
    await save()
    const first = (await load())!
    const write = (narrative: string) => appendMonthlyReport({ accountId: ACCOUNT, clientId: CLIENT, reportId: first.reportId,
      locale: 'en', narrative, snapshot: { ...first.snapshot, executiveSummary: narrative }, actorId: MEMBER })
    const results = await Promise.all([write('Queued draft two.'), write('Queued draft three.')])
    expect(results.map(r => r.versionNumber)).toEqual([2, 3])
    const latest = (await load())!
    const outcomes = await Promise.all([publish(first.versionId), publish(latest.versionId)])
    expect(outcomes.map(r => r.status)).toEqual([409, 200])
    expect((await load())!.publishedVersionId).toBe(latest.versionId)
  })

  it('gives the same neutral not-found page for wrong signatures, unknown, invalidated and revoked links', async () => {
    await save()
    const link = await share(), input = linkInput(link)
    const wrong = new URL(link); wrong.searchParams.set('s', 'x'.repeat(43))
    const unknown = new URL(link); unknown.pathname = `/en/r/${'u'.repeat(32)}`
    unknown.searchParams.set('s', signReportShare({ slug: 'u'.repeat(32), shareVersion: 1 }))
    const invalidated = new URL(link); invalidated.searchParams.set('v', '2')
    invalidated.searchParams.set('s', signReportShare({ slug: input.slug, shareVersion: 2 }))
    h.calls = []
    await expect(publicPage(wrong.toString())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.calls).toEqual([]) // Both resolvers verify before lookup.
    for (const candidate of [unknown.toString(), invalidated.toString()]) {
      await expect(publicPage(candidate)).rejects.toThrow('NEXT_NOT_FOUND')
    }
    await REVOKE(request(), ctx())
    await expect(publicPage(link)).rejects.toThrow('NEXT_NOT_FOUND')
    const renewed = await share()
    expect(renewed).not.toBe(link)
    expect(await resolvePublishedMonthlyReport(linkInput(renewed))).not.toBeNull()
    await expect(publicPage(link)).rejects.toThrow('NEXT_NOT_FOUND')
    // A correctly signed old generation at the current slug is expired by share-version rotation.
    const expired = new URL(renewed), renewedInput = linkInput(renewed)
    expired.searchParams.set('v', input.version)
    expired.searchParams.set('s', signReportShare({ slug: renewedInput.slug, shareVersion: Number(input.version) }))
    await expect(publicPage(expired.toString())).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('returns safe 503s over failed save/publish/revoke writes and a neutral public failure', async () => {
    await save()
    const draft = (await load())!
    const link = await share()
    const before = await q('select to_jsonb(r) as row from client_reports r')
    h.fail = true
    for (const response of [await save(), await publish(draft.versionId), await REVOKE(request(), ctx())]) {
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'MONTHLY_REPORT_UNAVAILABLE' })
    }
    await expect(publicPage(link)).rejects.toThrow('NEXT_NOT_FOUND')
    h.fail = false
    expect(await q('select to_jsonb(r) as row from client_reports r')).toEqual(before)
  })

  it.each([65536, 262144] as const)('handles a real large zh-HK draft under CHECK <= %i without a false success', async cap => {
    const original = h.pg
    if (cap === 65536) h.pg = await reportDatabase(cap)
    try {
      const title = '\u7e41'.repeat(160)
      await q(`insert into evidence_work_items(account_id, client_id, title, operation_status, created_at)
        select $1, $2, $3, case when n <= 100 then 'done' else 'todo' end, '2026-10-05'::timestamptz
        from generate_series(1, 120) n`, [ACCOUNT, CLIENT, title])
      await q(`insert into work_item_delivery_events(account_id, client_id, work_item_id, version_id, kind, provenance, recorded_at)
        select account_id, client_id, id, gen_random_uuid(), 'attest',
          case when row_number() over (order by id) <= 50 then 'verified_live' else 'self_reported' end, '2026-10-06'::timestamptz
        from evidence_work_items where account_id = $1 and client_id = $2 and operation_status = 'done'`, [ACCOUNT, CLIENT])
      const period = periodOf('2026-10')!
      const month = await readBrandMonth(ACCOUNT, CLIENT, period)
      if (month.state !== 'ok') throw new Error('Missing isolated fixture month')
      const snapshot = buildMonthlyReportSnapshot({
        locale: 'zh-HK', period, monthLabel: '2026-10', activity: month.activity, snapshots: month.snapshots,
        pulseWeeks: await readMonthPulseWeeks(ACCOUNT, CLIENT, period),
        branding: { agencyName: 'Fixture Agency', primaryColor: '#123ABC', logoUrl: null, contactLabel: null, contactUrl: null },
        client: { name: 'Fixture Bakery', domain: 'bakery.example' }, openWorkItems: await loadOpenWorkItems(ACCOUNT, CLIENT),
        narrative: '\u7e41'.repeat(1200), now: new Date(),
      })
      const [size] = await q<{ bytes: number }>('select octet_length($1::jsonb::text) as bytes', [JSON.stringify(snapshot)])
      expect(size.bytes).toBeGreaterThan(65536)
      expect(size.bytes).toBeLessThanOrEqual(262144)
      const response = await save('zh-HK', snapshot.executiveSummary)
      expect(response.status).toBe(cap === 65536 ? 503 : 201)
      const [stored] = await q<{ count: number }>('select count(*)::int as count from client_reports')
      expect(stored.count).toBe(cap === 65536 ? 0 : 1)
      if (cap === 65536) expect(await response.json()).toEqual({ error: 'MONTHLY_REPORT_UNAVAILABLE' })
    } finally {
      if (h.pg !== original) { await h.pg!.close(); h.pg = original }
    }
  })
})
