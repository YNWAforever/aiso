import { afterAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { createSummaryReceipt } from '@/lib/n8n/schema'
import { freezeReview, freezeMultiSourceReview } from '@/lib/change-sets/validation'
import { versionDTO } from '@/lib/change-sets/store'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import { writeResultDraftFixture } from '../../tests/fixtures/result-draft-build.mjs'
import { buildScanSummaryView } from '@/lib/view-models/scan-summary'

const clientId = '11111111-1111-4111-8111-111111111111'
const scanId = '22222222-2222-4222-8222-222222222222'
const envelope = buildScanEvidence({ requestedUrl: 'https://example.test/private', evaluatedUrl: 'https://example.test/private',
  industry: 'general_b2b', region: 'HK', sitemapSource: 'unknown', collectedAt: '2026-10-17T00:00:00Z',
  checks: { c9_meta_desc: { assessment: 'fail', collection: 'complete' }, c11_faq: { assessment: 'warn', collection: 'complete' } },
  observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.test' } }] })
const source = { kind: 'scan-check' as const, scanId, recordedAt: '2026-10-17T00:00:00Z', envelope }
const suggestions = deriveSuggestions(source)
const opportunities: OpportunityResponse = { schemaVersion: 1, window: { pulseWeek: null, pulseLimit: 200, pulseTruncated: false, scanId },
  sourceStates: { pulse: 'empty', scan: 'ok' }, savedDraftsState: 'ok', partial: true,
  suggestions: suggestions.map(row => ({ ...row, savedState: 'unsaved', saveAvailability: 'available' })) }
const result = { id: scanId, client_id: clientId, domain: 'example.test', url: 'https://example.test', score: 10, grade: 'F',
  created_at: source.recordedAt, results: { evidence: envelope, c9_meta_desc: { status: 'fail', message: 'meta_desc_missing' } } }
const summaryView = buildScanSummaryView(result)
const coverageResult = { ...result, results: { ...result.results, c11_faq: { status: 'pass', message: 'faq_present' },
  evidence: buildScanEvidence({ requestedUrl: result.url, evaluatedUrl: result.url,
    industry: 'general_b2b', region: 'HK', sitemapSource: 'unknown', collectedAt: source.recordedAt,
    checks: { c9_meta_desc: { assessment: 'fail', collection: 'complete' }, c11_faq: { assessment: 'pass', collection: 'complete' } },
    observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.test' } }] }) } }
const coverageView = buildScanSummaryView(coverageResult)
const failedResult = { ...result, score: 88, results: { ...result.results,
  evidence: buildScanEvidence({ requestedUrl: result.url, evaluatedUrl: result.url, industry: 'general_b2b', region: 'HK',
    sitemapSource: 'unknown', checks: {}, observations: [{ check: 'page', collection: 'failed', httpStatus: 503, target: { origin: 'https://example.test' } }] }) } }
const failedView = buildScanSummaryView(failedResult)
const unknownResult = { ...result, score: 88, results: { c9_meta_desc: result.results.c9_meta_desc } }
const unknownView = buildScanSummaryView(unknownResult)
const priorityEnvelope = buildScanEvidence({
  requestedUrl: 'https://example.test', evaluatedUrl: 'https://example.test', industry: 'general_b2b', region: 'HK', sitemapSource: 'unknown',
  checks: Object.fromEntries(['c1_robots', 'c9_meta_desc', 'c10_headings', 'c11_faq', 'c15_entity', 'c17_citation_density']
    .map((key, index) => [key, { assessment: index < 2 ? 'fail' as const : 'warn' as const, collection: 'complete' as const }])),
})
const priorities = { ...opportunities, suggestions: deriveSuggestions({ ...source, envelope: priorityEnvelope })
  .map(row => ({ ...row, savedState: 'unsaved' as const, saveAvailability: 'available' as const })) }
const failedReceipt = { ...createSummaryReceipt(result).receipt, state: 'failed', error: 'PROVIDER_FAILED' }
const drafts = Object.fromEntries((['en', 'zh-HK'] as const).map(locale => {
  const snapshot = buildInitialDraftSnapshot(suggestions[0], source, locale)
  return [locale, { id: '44444444-4444-4444-8444-444444444444', clientId, status: 'draft' as const, title: snapshot.initialTitle,
    action: snapshot.initialAction, notes: '', locale, revision: 1, createdAt: source.recordedAt, updatedAt: source.recordedAt, evidenceSnapshot: snapshot }]
}))
const legacyVersions = Object.fromEntries(([1, 2] as const).map(schema => [schema,
  Object.fromEntries((['en', 'zh-HK'] as const).map(locale => {
    const item = drafts[locale]
    const frozen = schema === 1 ? freezeReview(item) : freezeMultiSourceReview(item, [item.evidenceSnapshot])
    return [locale, versionDTO({
      id: '55555555-5555-4555-8555-555555555555', work_item_id: item.id, version_number: 1, draft_revision: item.revision,
      content: frozen.content, content_hash: frozen.contentHash, validation: frozen.validation,
      submitter: { profileId: clientId, displayName: 'Synthetic legacy submitter', role: 'account_member' },
      submitted_at: '2026-10-17T00:00:00Z', decision_record: null, can_decide: false,
    })]
  })),
]))
it('fixture uses real source ranking, snapshots and a selected scan; no provider call', () => {
  expect(suggestions[0].source).toMatchObject({ id: scanId, checkKey: 'c9_meta_desc' })
  expect(drafts.en.evidenceSnapshot.evidence).toMatchObject({ scanId, checkKey: 'c9_meta_desc' })
})
afterAll(async () => {
  if (process.env.AISO_RESULT_DRAFT_FIXTURE !== '1') return
  const dir = resolve(process.env.AISO_RESULT_DRAFT_DIR || 'artifacts/result-to-draft-20261017/browser')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ clientId, scanId, result, summaryView, coverageResult, coverageView,
    failedResult, failedView, unknownResult, unknownView, priorities, failedReceipt, opportunities, drafts, legacyVersions }))
  await writeResultDraftFixture()
})
