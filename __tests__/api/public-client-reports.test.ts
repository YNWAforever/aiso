import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

process.env.REPORT_SHARE_SECRET = 'test-report-share-secret-that-is-at-least-32-characters'

const h = vi.hoisted(() => ({
  resolvePublicClientReport: vi.fn(),
  incrementClientReportCtaClick: vi.fn(),
  fetchReportLogo: vi.fn(),
}))

vi.mock('@/lib/reports/store', () => ({
  resolvePublicClientReport: h.resolvePublicClientReport,
  incrementClientReportCtaClick: h.incrementClientReportCtaClick,
}))

vi.mock('@/lib/reports/branding', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reports/branding')>()
  return { ...actual, fetchReportLogo: h.fetchReportLogo }
})

import nextConfig from '@/next.config'
import {
  buildReportShareUrl,
  signReportShare,
} from '@/lib/reports/share'
import {
  PUBLIC_REPORT_CSP,
  publicReportHeaders,
  resolvePublishedClientReport,
} from '@/lib/reports/public'
import { GET as GET_LOGO } from '@/app/api/public/client-reports/[slug]/logo/route'
import { GET as GET_CONTACT } from '@/app/api/public/client-reports/[slug]/contact/route'

const slug = 'a'.repeat(32)
const shareVersion = 2

const snapshot = {
  snapshotSchemaVersion: 1 as const,
  locale: 'en' as const,
  branding: {
    agencyName: 'Acme Agency',
    logoUrl: 'https://agency.example/logo.png',
    primaryColor: '#123ABC',
    contactLabel: 'Contact Acme',
    contactUrl: 'https://agency.example/contact',
    attribution: 'Powered by Fimmick AISO' as const,
    internalWebhook: 'SENTINEL_BRANDING_SECRET',
  },
  client: { name: 'Example Client', domain: 'example.com', accountId: 'SENTINEL_ACCOUNT' },
  evidence: {
    scanDate: '2026-07-21T08:00:00.000Z',
    evidenceTimestamp: '2026-07-21T08:05:00.000Z',
    rawHtml: 'SENTINEL_RAW_HTML',
  },
  score: {
    current: 82,
    grade: 'A',
    comparisonState: 'comparable' as const,
    previous: 75,
    delta: 7,
    previousScanDate: '2026-07-20T08:00:00.000Z',
  },
  changes: [
    { key: 'robots', label: 'Robots access', kind: 'improved' as const, raw: 'SENTINEL_CHANGE' },
  ],
  priorityFixes: [
    {
      key: 'schema',
      title: 'Add organization schema',
      rationale: 'Make the company identity explicit.',
      expectedImpact: 'high' as const,
      nextStep: 'Publish validated Organization JSON-LD.',
      assignee: 'SENTINEL_ASSIGNEE',
    },
  ],
  executiveSummary: 'Measured visibility improved while one high-impact opportunity remains.',
  methodology: 'This report uses only checks captured in the selected scans.',
  internalNotes: 'SENTINEL_INTERNAL_NOTES',
}

const published = {
  report: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    account_id: '22222222-2222-4222-8222-222222222222',
    client_id: '33333333-3333-4333-8333-333333333333',
    status: 'published' as const,
    public_slug: slug,
    share_version: shareVersion,
    latest_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    published_version_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    view_count: 8,
    cta_click_count: 3,
    first_viewed_at: null,
    last_viewed_at: null,
    published_at: '2026-07-21T08:30:00.000Z',
    revoked_at: null,
    created_by: null,
    created_at: '2026-07-21T08:00:00.000Z',
    updated_at: '2026-07-21T10:00:00.000Z',
  },
  version: {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    report_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    account_id: '22222222-2222-4222-8222-222222222222',
    client_id: '33333333-3333-4333-8333-333333333333',
    version_number: 1,
    source_scan_id: null,
    previous_scan_id: null,
    locale: 'en' as const,
    executive_summary: snapshot.executiveSummary,
    snapshot_schema_version: 1 as const,
    snapshot,
    created_by: null,
    created_at: '2026-07-21T08:00:00.000Z',
  },
  account: {
    id: '22222222-2222-4222-8222-222222222222',
    plan: 'pro',
    status: 'active',
    stripe_subscription_id: 'sub_pro',
    trial_ends_at: null,
  },
}

function signature(version = shareVersion) {
  return signReportShare({ slug, shareVersion: version })
}

function context() {
  return { params: Promise.resolve({ slug }) }
}

function publicRequest(kind: 'logo' | 'contact', options?: { version?: string; signature?: string; suffix?: string }) {
  const params = new URLSearchParams({
    v: options?.version ?? String(shareVersion),
    s: options?.signature ?? signature(),
  })
  return new Request(
    `https://reports.example/api/public/client-reports/${slug}/${kind}?${params}${options?.suffix ?? ''}`,
  )
}

function expectNeutralNotFound(response: Response) {
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-security-policy')).toBe(PUBLIC_REPORT_CSP)
}

describe('published client report resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.resolvePublicClientReport.mockResolvedValue(published)
  })

  it('verifies canonical v/s credentials before the first database lookup', async () => {
    await expect(resolvePublishedClientReport({
      slug,
      version: '02',
      signature: signature(),
    })).resolves.toBeNull()
    await expect(resolvePublishedClientReport({
      slug,
      version: String(shareVersion),
      signature: 'not-a-signature',
    })).resolves.toBeNull()

    expect(h.resolvePublicClientReport).not.toHaveBeenCalled()
  })

  it('accepts the canonical generated signed URL directly as public page resolver input', async () => {
    const signedUrl = new URL(buildReportShareUrl({
      origin: 'https://reports.example',
      locale: 'zh-HK',
      slug,
      shareVersion,
    }))
    const [, lang, route, routeSlug] = signedUrl.pathname.split('/')

    expect({ lang, route, routeSlug }).toEqual({ lang: 'zh-HK', route: 'r', routeSlug: slug })
    expect(signedUrl.pathname).not.toContain('/reports/')
    expect([...signedUrl.searchParams.keys()].sort()).toEqual(['s', 'v'])
    await expect(resolvePublishedClientReport({
      slug: routeSlug,
      version: signedUrl.searchParams.get('v'),
      signature: signedUrl.searchParams.get('s'),
    })).resolves.toMatchObject({ dto: { report: { client: { domain: 'example.com' } } } })
  })

  it('maps only the published immutable snapshot allowlist and ignores a newer draft pointer', async () => {
    const resolved = await resolvePublishedClientReport({
      slug,
      version: String(shareVersion),
      signature: signature(),
    })

    expect(h.resolvePublicClientReport).toHaveBeenCalledWith({
      publicSlug: slug,
      shareVersion,
    })
    expect(resolved?.dto.publishedAt).toBe(published.report.published_at)
    expect(resolved?.dto.report.executiveSummary).toBe(snapshot.executiveSummary)
    expect(resolved?.dto.report.priorityFixes).toHaveLength(1)
    expect(resolved?.assets).toEqual({
      logoUrl: snapshot.branding.logoUrl,
      contactUrl: snapshot.branding.contactUrl,
    })
    const serialized = JSON.stringify(resolved?.dto)
    for (const sentinel of [
      'SENTINEL_BRANDING_SECRET',
      'SENTINEL_ACCOUNT',
      'SENTINEL_RAW_HTML',
      'SENTINEL_CHANGE',
      'SENTINEL_ASSIGNEE',
      'SENTINEL_INTERNAL_NOTES',
      published.report.account_id,
      published.report.client_id,
      published.report.latest_version_id,
    ]) {
      expect(serialized).not.toContain(sentinel)
    }
  })

  it.each([
    ['unknown slug', null],
    ['draft', { ...published, report: { ...published.report, status: 'draft' } }],
    ['revoked', { ...published, report: { ...published.report, status: 'revoked' } }],
    ['missing pointer', { ...published, report: { ...published.report, published_version_id: null } }],
    ['wrong published version', {
      ...published,
      version: { ...published.version, id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9' },
    }],
    ['downgrade', {
      ...published,
      account: { ...published.account, plan: 'basic', stripe_subscription_id: 'sub_basic' },
    }],
    ['failed-closed account', {
      ...published,
      account: { ...published.account, status: 'past_due' },
    }],
    ['malformed snapshot', {
      ...published,
      version: { ...published.version, snapshot: { ...snapshot, snapshotSchemaVersion: 99 } },
    }],
  ])('returns one null outcome for %s', async (_name, value) => {
    h.resolvePublicClientReport.mockResolvedValue(value)

    await expect(resolvePublishedClientReport({
      slug,
      version: String(shareVersion),
      signature: signature(),
    })).resolves.toBeNull()
  })

  it('fails closed on entitlement/store errors and logs no sensitive public data', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.resolvePublicClientReport.mockRejectedValue(new Error('database failure containing private data'))

    await expect(resolvePublishedClientReport({
      slug,
      version: String(shareVersion),
      signature: signature(),
    })).resolves.toBeNull()

    const logged = JSON.stringify(warning.mock.calls)
    expect(logged).not.toContain(slug)
    expect(logged).not.toContain(signature())
    expect(logged).not.toContain(snapshot.branding.contactUrl)
    expect(logged).not.toContain(snapshot.executiveSummary)
    warning.mockRestore()
  })
})

describe('public report HTML security policy', () => {
  it('applies the same public security headers to valid and invalid localized HTML routes', async () => {
    expect(nextConfig.headers).toBeTypeOf('function')
    const rules = await nextConfig.headers?.()
    const publicHtmlRule = rules?.find(rule => rule.source === '/:lang(en|zh-HK)/r/:slug')
    const configuredHeaders = Object.fromEntries(
      (publicHtmlRule?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]),
    )

    expect(publicHtmlRule).toBeDefined()
    expect(configuredHeaders).toEqual(Object.fromEntries(publicReportHeaders()))
  })

  it('allows only the same-origin Next runtime, CSS, fonts, and report logo transport', () => {
    expect(PUBLIC_REPORT_CSP).toContain("script-src 'self' 'unsafe-inline'")
    expect(PUBLIC_REPORT_CSP).toContain("connect-src 'self'")
    expect(PUBLIC_REPORT_CSP).toContain("img-src 'self' data:")
    expect(PUBLIC_REPORT_CSP).not.toMatch(/\bhttps?:/)
    expect(PUBLIC_REPORT_CSP).toContain("object-src 'none'")
    expect(PUBLIC_REPORT_CSP).toContain("frame-ancestors 'none'")
  })
})

describe('public report asset handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.resolvePublicClientReport.mockResolvedValue(published)
    h.fetchReportLogo.mockResolvedValue({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      contentType: 'image/png',
      etag: null,
      lastModified: null,
      cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    })
  })

  it('authorizes publication and entitlement before fetching the stored snapshot logo', async () => {
    const invalid = await GET_LOGO(
      publicRequest('logo', { signature: 'bad' }),
      context(),
    )
    expectNeutralNotFound(invalid)
    expect(h.fetchReportLogo).not.toHaveBeenCalled()

    const valid = await GET_LOGO(publicRequest('logo'), context())
    expect(valid.status).toBe(200)
    expect(h.fetchReportLogo).toHaveBeenCalledWith(snapshot.branding.logoUrl)
    expect(valid.headers.get('content-type')).toBe('image/png')
    expect(valid.headers.get('cache-control')).toBe('no-store')
    expect(valid.headers.get('x-content-type-options')).toBe('nosniff')
    expect(valid.headers.get('content-security-policy')).toBe(PUBLIC_REPORT_CSP)
  })

  it('redirects only to the published snapshot destination and ignores request destinations', async () => {
    h.incrementClientReportCtaClick.mockRejectedValue(new Error('analytics unavailable'))

    const response = await GET_CONTACT(
      publicRequest('contact', { suffix: '&to=https://attacker.example' }),
      context(),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(snapshot.branding.contactUrl)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(h.incrementClientReportCtaClick).toHaveBeenCalledWith({
      publicSlug: slug,
      shareVersion,
    })
  })

  it.each([
    'http://agency.example/contact',
    'https://agency.example/contact\r\nX-Injected: yes',
  ])('rejects unsafe contact destination %s with the neutral 404', async contactUrl => {
    h.resolvePublicClientReport.mockResolvedValue({
      ...published,
      version: {
        ...published.version,
        snapshot: {
          ...snapshot,
          branding: { ...snapshot.branding, contactUrl },
        },
      },
    })

    const response = await GET_CONTACT(publicRequest('contact'), context())

    expectNeutralNotFound(response)
    expect(h.incrementClientReportCtaClick).not.toHaveBeenCalled()
  })

  it('uses an identical neutral 404 body and headers across both invalid handlers', async () => {
    const logo = await GET_LOGO(publicRequest('logo', { signature: 'bad' }), context())
    const contact = await GET_CONTACT(publicRequest('contact', { signature: 'bad' }), context())

    expect(await logo.text()).toBe('Not Found')
    expect(await contact.text()).toBe('Not Found')
    expect([...logo.headers]).toEqual([...contact.headers])
  })
})
