import { describe, expect, it } from 'vitest'
import {
  dashboardReportAssetUrls,
  parseBrandingResponse,
  parseReportLifecycleResponse,
  parseReportSaveResponse,
} from '@/lib/reports/client-dto'

const snapshot = {
  snapshotSchemaVersion: 1,
  locale: 'en',
  branding: {
    agencyName: 'Acme Agency',
    logoUrl: 'https://agency.example/logo.png',
    primaryColor: '#123ABC',
    contactLabel: 'Contact us',
    contactUrl: 'https://agency.example/contact',
    attribution: 'Powered by Fimmick AISO',
  },
  client: { name: 'Example Client', domain: 'example.com' },
  evidence: {
    scanDate: '2026-07-21T08:00:00.000Z',
    evidenceTimestamp: '2026-07-21T08:00:00.000Z',
  },
  score: {
    current: 82,
    grade: 'A',
    comparisonState: 'baseline',
  },
  changes: [],
  priorityFixes: [],
  executiveSummary: 'A sufficiently detailed client report summary that is safe to review.',
  methodology: 'Based only on captured scan evidence.',
}

const report = {
  id: 'report-1',
  status: 'draft',
  latestVersionNumber: 1,
  publishedVersionNumber: null,
  publishedAt: null,
  firstViewedAt: null,
  lastViewedAt: null,
  viewCount: 0,
  ctaClickCount: 0,
}

describe('report client DTO validation', () => {
  it('accepts a complete immutable save artifact and rejects malformed successful JSON', () => {
    const valid = {
      report,
      reviewArtifact: {
        versionId: 'version-1',
        versionNumber: 1,
        snapshot,
      },
    }

    expect(parseReportSaveResponse(valid)).toEqual(valid)
    expect(parseReportSaveResponse({ report: {} })).toBeNull()
    expect(parseReportSaveResponse({
      ...valid,
      reviewArtifact: { ...valid.reviewArtifact, snapshot: { snapshotSchemaVersion: 1 } },
    })).toBeNull()
    expect(parseReportSaveResponse({
      ...valid,
      reviewArtifact: {
        ...valid.reviewArtifact,
        snapshot: {
          ...snapshot,
          score: { current: 82, grade: 'A', comparisonState: 'comparable' },
        },
      },
    })).toBeNull()
  })

  it('fails closed for malformed branding and lifecycle success payloads', () => {
    expect(parseBrandingResponse({
      branding: {
        agencyName: 'Acme Agency',
        logoUrl: null,
        primaryColor: '#123ABC',
        contactLabel: null,
        contactUrl: null,
      },
    })).not.toBeNull()
    expect(parseBrandingResponse({})).toBeNull()
    expect(parseBrandingResponse({ branding: { agencyName: 'Acme Agency' } })).toBeNull()
    expect(parseBrandingResponse({
      branding: {
        agencyName: 'Acme Agency',
        logoUrl: 'javascript:alert(1)',
        primaryColor: '#123ABC',
        contactLabel: null,
        contactUrl: null,
      },
    })).toBeNull()
    expect(parseReportLifecycleResponse({ report, signedUrl: '/en/r/signed' }, true)).not.toBeNull()
    expect(parseReportLifecycleResponse({ report, signedUrl: 'javascript:alert(1)' }, true)).toBeNull()
    expect(parseReportLifecycleResponse({ report: {} }, false)).toBeNull()
    expect(parseReportLifecycleResponse({ report }, true)).toBeNull()
  })

  it('builds only same-origin version-scoped dashboard preview asset paths', () => {
    expect(dashboardReportAssetUrls('report /1', 'version /1')).toEqual({
      logoProxyUrl: '/api/client-reports/report%20%2F1/versions/version%20%2F1/logo',
      contactProxyUrl: '/api/client-reports/report%20%2F1/versions/version%20%2F1/contact',
    })
  })
})
