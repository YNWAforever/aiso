import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { parseCreateDraft } from '@/lib/work-items/schema'
import { serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { buildReportFindingCandidates } from '@/lib/reports/finding-candidates'
import { reportSnapshot } from '../components/report-builder-fixtures'

const reportId = '11111111-1111-4111-8111-111111111111'
const reportVersionId = '22222222-2222-4222-8222-222222222222'
const scanId = '33333333-3333-4333-8333-333333333333'

function fixture() {
  const envelope = buildScanEvidence({
    requestedUrl: 'https://example.test/',
    evaluatedUrl: 'https://example.test/',
    industry: 'general_b2b',
    region: 'HK',
    sitemapSource: 'unknown',
    checks: { c1_robots: { assessment: 'fail', collection: 'complete' } },
    observations: [{
      observedAt: '2026-10-18T09:00:00.000Z',
      provenance: 'validated-fetch',
      collection: 'complete',
      target: {
        origin: 'https://example.test', pathRedacted: false, queryRedacted: false,
        fragmentRedacted: false, originNormalized: true,
      },
      httpStatus: 200,
      signals: { mimeType: 'text/plain' },
      check: 'page',
    }],
  })
  const snapshot = {
    ...reportSnapshot('en'),
    priorityFixes: [{
      key: 'c1_robots',
      title: 'Review crawler access',
      rationale: 'The report recorded a robots check failure for the selected scan.',
      expectedImpact: 'high' as const,
      nextStep: 'Review robots.txt and submit a verified change for later observation.',
    }],
  }
  return { envelope, snapshot, source: { kind: 'scan-check' as const, scanId, recordedAt: '2026-10-18T09:00:00.000Z', envelope } }
}

describe('report finding to work item provenance', () => {
  it('freezes the selected report version and only returns actionable report findings', () => {
    const { envelope, snapshot } = fixture()
    const candidates = buildReportFindingCandidates({
      reportId,
      reportVersionId,
      reportVersionNumber: 2,
      reportCreatedAt: '2026-10-18T09:02:00.000Z',
      scanId,
      scanCreatedAt: '2026-10-18T09:00:00.000Z',
      scanResults: { evidence: envelope },
      snapshot,
      locale: 'en',
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      checkKey: 'c1_robots',
      title: 'Review crawler access',
      rationale: snapshot.priorityFixes[0].rationale,
      expectedImpact: 'high',
      nextStep: snapshot.priorityFixes[0].nextStep,
      source: { kind: 'scan-check', id: scanId, checkKey: 'c1_robots' },
      reportProvenance: {
        reportId,
        reportVersionId,
        reportVersionNumber: 2,
        findingKey: 'c1_robots',
        reportCreatedAt: '2026-10-18T09:02:00.000Z',
      },
    })
    expect(candidates[0].targetUrl).toBe('https://example.test')
    expect(candidates[0].observations).toEqual([
      expect.objectContaining({
        observedAt: '2026-10-18T09:00:00.000Z',
        provenance: 'validated-fetch',
        httpStatus: 200,
        check: 'page',
      }),
    ])
  })

  it('snapshots report provenance without allowing a later report to mutate it', () => {
    const { source } = fixture()
    const suggestion = deriveSuggestions(source)[0]
    const reportProvenance = {
      reportId,
      reportVersionId,
      reportVersionNumber: 2,
      reportCreatedAt: '2026-10-18T09:02:00.000Z',
      findingKey: 'c1_robots' as const,
      findingTitle: suggestion.titleKey,
      findingRationale: suggestion.args.assessment,
      findingNextStep: suggestion.actionKey,
      expectedImpact: 'high' as const,
    }
    const snapshot = buildInitialDraftSnapshot(suggestion, source, 'en', reportProvenance)
    expect(JSON.parse(serializeDraftSnapshot(snapshot))).toMatchObject({
      reportProvenance: {
        reportId,
        reportVersionId,
        reportVersionNumber: 2,
        findingKey: 'c1_robots',
        targetOrigin: 'https://example.test',
      },
    })
    expect(parseCreateDraft({
      source: suggestion.source,
      ruleVersion: suggestion.ruleVersion,
      fingerprint: suggestion.fingerprint,
      locale: 'en',
      reportVersionId,
    })).toMatchObject({ source: suggestion.source, reportVersionId })
    expect(() => parseCreateDraft({
      source: { kind: 'pulse-metric', id: reportVersionId },
      ruleVersion: 'pulse-brand-absent.v1',
      fingerprint: 'a'.repeat(64),
      locale: 'en',
      reportVersionId,
    })).toThrow('INVALID_WORK_ITEM_INPUT')
  })
})
