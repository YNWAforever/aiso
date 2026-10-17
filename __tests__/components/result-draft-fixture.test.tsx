import { afterAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { createSummaryReceipt } from '@/lib/n8n/schema'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import { writeResultDraftFixture } from '../../tests/fixtures/result-draft-build.mjs'

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
const failedReceipt = { ...createSummaryReceipt(result).receipt, state: 'failed', error: 'PROVIDER_FAILED' }
const drafts = Object.fromEntries((['en', 'zh-HK'] as const).map(locale => {
  const snapshot = buildInitialDraftSnapshot(suggestions[0], source, locale)
  return [locale, { id: '44444444-4444-4444-8444-444444444444', clientId, status: 'draft', title: snapshot.initialTitle,
    action: snapshot.initialAction, notes: '', locale, revision: 1, createdAt: source.recordedAt, updatedAt: source.recordedAt, evidenceSnapshot: snapshot }]
}))
it('fixture uses real source ranking, snapshots and a selected scan; no provider call', () => {
  expect(suggestions[0].source).toMatchObject({ id: scanId, checkKey: 'c9_meta_desc' })
  expect(drafts.en.evidenceSnapshot.evidence).toMatchObject({ scanId, checkKey: 'c9_meta_desc' })
})
afterAll(async () => {
  if (process.env.AISO_RESULT_DRAFT_FIXTURE !== '1') return
  const dir = resolve('artifacts/result-to-draft-20261017/browser')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ clientId, scanId, result, failedReceipt, opportunities, drafts }))
  await writeResultDraftFixture()
})
