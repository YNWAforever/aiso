import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  resolvePublishedClientReport: vi.fn(),
  incrementClientReportView: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/reports/public', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reports/public')>()
  return {
    ...actual,
    resolvePublishedClientReport: h.resolvePublishedClientReport,
  }
})

vi.mock('@/lib/reports/store', () => ({
  incrementClientReportView: h.incrementClientReportView,
}))

vi.mock('next/navigation', () => ({ notFound: h.notFound }))

import PublicReportPage, {
  dynamic,
  generateMetadata,
} from '@/app/[lang]/r/[slug]/page'
import PublicReportNotFound from '@/app/[lang]/r/[slug]/not-found'

const slug = 'a'.repeat(32)
const signature = 'b'.repeat(43)

function fixes(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    key: `fix-${index + 1}`,
    title: `Priority ${index + 1}`,
    rationale: `Evidence-backed rationale ${index + 1}.`,
    expectedImpact: index === 0 ? 'high' as const : 'medium' as const,
    nextStep: `Take next step ${index + 1}.`,
  }))
}

const resolved = {
  dto: {
    publishedAt: '2026-07-21T08:30:00.000Z',
    logoProxyUrl: `/api/public/client-reports/${slug}/logo?v=2&s=${signature}`,
    contactProxyUrl: `/api/public/client-reports/${slug}/contact?v=2&s=${signature}`,
    report: {
      snapshotSchemaVersion: 1 as const,
      locale: 'en' as const,
      branding: {
        agencyName: 'Acme Agency',
        logoUrl: 'https://agency.example/logo.png',
        primaryColor: '#123ABC',
        contactLabel: 'Contact Acme',
        contactUrl: 'https://agency.example/contact',
        attribution: 'Powered by Fimmick AISO' as const,
      },
      client: { name: 'Example Client', domain: 'example.com' },
      evidence: {
        scanDate: '2026-07-21T08:00:00.000Z',
        evidenceTimestamp: '2026-07-21T08:05:00.000Z',
      },
      score: {
        current: 82,
        grade: 'A',
        comparisonState: 'baseline' as const,
      },
      changes: [
        { key: 'robots', label: 'Robots access', kind: 'improved' as const },
        { key: 'schema', label: 'Organization schema', kind: 'regressed' as const },
      ],
      priorityFixes: fixes(),
      executiveSummary: 'Published summary remains stable while a newer draft exists.',
      methodology: 'This report uses only checks captured in the selected scans.',
    },
  },
  assets: {
    logoUrl: 'https://agency.example/logo.png',
    contactUrl: 'https://agency.example/contact',
  },
}

function props(lang = 'en') {
  return {
    params: Promise.resolve({ lang, slug }),
    searchParams: Promise.resolve({ v: '2', s: signature }),
  }
}

describe('public client report page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.resolvePublishedClientReport.mockResolvedValue(resolved)
  })

  it('renders the published snapshot as one semantic, responsive, server-only report', async () => {
    h.incrementClientReportView.mockRejectedValue(new Error('counter unavailable'))

    const markup = renderToStaticMarkup(await PublicReportPage(props()))

    expect((markup.match(/<main/g) ?? [])).toHaveLength(1)
    expect(markup).toContain('Acme Agency')
    expect(markup).toContain('Example Client')
    expect(markup).toContain('example.com')
    expect(markup).toContain('Published summary remains stable')
    expect(markup).toContain('82')
    expect(markup).toContain('Grade A')
    expect(markup).toContain('first measured benchmark')
    expect(markup).toContain('Improved')
    expect(markup).toContain('Regressed')
    expect(markup).toContain('Powered by Fimmick AISO')
    expect(markup).toContain('Methodology and coverage')
    expect(markup).toContain('--report-primary:#123ABC')
    expect(markup).toContain(resolved.dto.logoProxyUrl.replaceAll('&', '&amp;'))
    expect(markup).toContain(resolved.dto.contactProxyUrl.replaceAll('&', '&amp;'))
    expect(markup).not.toContain('https://agency.example')
    expect(markup).not.toContain('Priority 6')
    expect(markup).not.toContain('PDF')
    expect(h.incrementClientReportView).toHaveBeenCalledWith({
      publicSlug: slug,
      shareVersion: 2,
    })
  })

  it('shows truthful comparable delta copy and prior scan date only when comparable', async () => {
    h.resolvePublishedClientReport.mockResolvedValue({
      ...resolved,
      dto: {
        ...resolved.dto,
        report: {
          ...resolved.dto.report,
          score: {
            current: 82,
            grade: 'A',
            comparisonState: 'comparable',
            previous: 75,
            delta: 7,
            previousScanDate: '2026-07-20T08:00:00.000Z',
          },
        },
      },
    })

    const markup = renderToStaticMarkup(await PublicReportPage(props()))

    expect(markup).toContain('+7')
    expect(markup).toContain('closest eligible scan')
    expect(markup).not.toContain('first measured benchmark')
  })

  it('falls back from a valid but inaccessible Agency color', async () => {
    h.resolvePublishedClientReport.mockResolvedValue({
      ...resolved,
      dto: {
        ...resolved.dto,
        report: {
          ...resolved.dto.report,
          branding: { ...resolved.dto.report.branding, primaryColor: '#FFFFFF' },
        },
      },
    })

    const markup = renderToStaticMarkup(await PublicReportPage(props()))

    expect(markup).toContain('--report-primary:#2563EB')
    expect(markup).not.toContain('--report-primary:#FFFFFF')
  })
  it('uses a safe fallback instead of applying an invalid Agency color', async () => {
    h.resolvePublishedClientReport.mockResolvedValue({
      ...resolved,
      dto: {
        ...resolved.dto,
        report: {
          ...resolved.dto.report,
          branding: { ...resolved.dto.report.branding, primaryColor: 'red;position:fixed' },
        },
      },
    })

    const markup = renderToStaticMarkup(await PublicReportPage(props()))

    expect(markup).toContain('--report-primary:#2563EB')
    expect(markup).not.toContain('position:fixed')
  })

  it('returns the same not-found path before counting any invalid report view', async () => {
    h.resolvePublishedClientReport.mockResolvedValue(null)

    await expect(PublicReportPage(props())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.notFound).toHaveBeenCalledOnce()
    expect(h.incrementClientReportView).not.toHaveBeenCalled()
  })

  it('waits for the resolver before selecting the non-streamed not-found path', async () => {
    let release!: (value: typeof resolved | null) => void
    h.resolvePublishedClientReport.mockReturnValueOnce(new Promise(resolve => {
      release = resolve
    }))

    const pendingPage = PublicReportPage(props())
    await Promise.resolve()

    expect(h.notFound).not.toHaveBeenCalled()
    expect(h.incrementClientReportView).not.toHaveBeenCalled()

    release(null)
    await expect(pendingPage).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.incrementClientReportView).not.toHaveBeenCalled()
  })

  it('forces request-time rendering and exposes only the neutral visible not-found message', () => {
    const markup = renderToStaticMarkup(<PublicReportNotFound />)
    const visibleText = markup.replace(/<[^>]+>/g, '')

    expect(dynamic).toBe('force-dynamic')
    expect(visibleText).toBe('Not Found')
    expect(markup).toContain('<h1')
    expect(markup).not.toMatch(/report|Fimmick|href|zh-HK/i)
  })

  it.each([
    ['en', 'Client report — Fimmick AISO'],
    ['zh-HK', '客戶報告 — Fimmick AISO'],
  ])('returns localized generic noindex metadata for %s', async (lang, title) => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ lang, slug }),
      searchParams: Promise.resolve({ v: '2', s: signature }),
    })

    expect(metadata).toEqual({
      title,
      robots: { index: false, follow: false, nocache: true },
      referrer: 'no-referrer',
    })
    expect(h.resolvePublishedClientReport).not.toHaveBeenCalled()
  })
})
