import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadPreviewVersion: vi.fn(),
  fetchReportLogo: vi.fn(),
  normalizeReportContact: vi.fn(),
}))

vi.mock('@/lib/reports/service', () => {
  class ReportServiceError extends Error {
    readonly code: string
    readonly status: number

    constructor(code: string) {
      super(code)
      this.code = code
      this.status = {
        invalid_request: 400,
        unauthorized: 401,
        not_found: 404,
        conflict: 409,
      }[code] ?? 503
    }
  }

  return {
    ReportServiceError,
    loadAuthenticatedClientReportPreviewVersion: h.loadPreviewVersion,
    reportErrorResponse(error: unknown) {
      const safe = error instanceof ReportServiceError
        ? error
        : new ReportServiceError('service_unavailable')
      return Response.json(
        { error: safe.code },
        { status: safe.status, headers: { 'Cache-Control': 'no-store' } },
      )
    },
  }
})

vi.mock('@/lib/reports/branding', () => ({
  fetchReportLogo: h.fetchReportLogo,
  normalizeReportContact: h.normalizeReportContact,
}))

import { GET as GET_LOGO } from '@/app/api/client-reports/[reportId]/versions/[versionId]/logo/route'
import { GET as GET_CONTACT } from '@/app/api/client-reports/[reportId]/versions/[versionId]/contact/route'

const reportId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const versionId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const context = {
  params: Promise.resolve({ reportId, versionId }),
} as RouteContext<'/api/client-reports/[reportId]/versions/[versionId]/logo'>

describe('authenticated client report preview assets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.loadPreviewVersion.mockResolvedValue({
      snapshot: {
        branding: {
          logoUrl: 'https://agency.example/logo.png',
          contactLabel: 'Contact us',
          contactUrl: 'https://agency.example/contact',
        },
      },
    })
    h.fetchReportLogo.mockResolvedValue({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
    })
    h.normalizeReportContact.mockImplementation((contactLabel, contactUrl) => ({
      contactLabel,
      contactUrl,
    }))
  })

  it('loads the exact owned version before proxying a validated logo without cache leakage', async () => {
    const response = await GET_LOGO(new Request('https://app.example/logo'), context)

    expect(response.status).toBe(200)
    expect(h.loadPreviewVersion).toHaveBeenCalledWith(reportId, versionId)
    expect(h.fetchReportLogo).toHaveBeenCalledWith('https://agency.example/logo.png')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('revalidates and redirects the saved contact destination without referrer leakage', async () => {
    const response = await GET_CONTACT(
      new Request('https://app.example/contact'),
      context as unknown as RouteContext<'/api/client-reports/[reportId]/versions/[versionId]/contact'>,
    )

    expect(response.status).toBe(303)
    expect(h.loadPreviewVersion).toHaveBeenCalledWith(reportId, versionId)
    expect(h.normalizeReportContact).toHaveBeenCalledWith(
      'Contact us',
      'https://agency.example/contact',
    )
    expect(response.headers.get('location')).toBe('https://agency.example/contact')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('rejects non-canonical identifiers before any report lookup', async () => {
    const response = await GET_LOGO(
      new Request('https://app.example/logo'),
      {
        params: Promise.resolve({ reportId: 'not-a-uuid', versionId }),
      } as RouteContext<'/api/client-reports/[reportId]/versions/[versionId]/logo'>,
    )

    expect(response.status).toBe(400)
    expect(h.loadPreviewVersion).not.toHaveBeenCalled()
    expect(h.fetchReportLogo).not.toHaveBeenCalled()
  })
})
