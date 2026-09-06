import type { OpportunityResponse } from '@/lib/opportunities/types'
import type { WorkItem } from '@/lib/work-items/schema'
export const clientId = '11111111-1111-4111-8111-111111111111'
export const initial: OpportunityResponse = {
  schemaVersion: 1,
  window: {
    pulseWeek: '2026-09-01',
    pulseLimit: 200,
    pulseTruncated: true,
    scanId: null,
  },
  sourceStates: { pulse: 'ok', scan: 'unavailable' },
  savedDraftsState: 'unavailable',
  partial: true,
  suggestions: [
    {
      key: 'pulse-fixture',
      ruleVersion: 'pulse-brand-absent.v1',
      source: {
        kind: 'pulse-metric',
        id: '33333333-3333-4333-8333-333333333333',
      },
      fingerprint: 'a'.repeat(64),
      titleKey: 'review-question-coverage',
      actionKey: 'review-question-coverage',
      args: {
        question: 'Historical <script>alert(1)</script> 問題',
        platform: 'ChatGPT',
      },
      evidence: {
        kind: 'pulse-metric',
        id: '33333333-3333-4333-8333-333333333333',
        promptId: null,
        question: 'Historical <script>alert(1)</script> 問題',
        platform: 'ChatGPT',
        scanWeek: '2026-09-01',
        recordedAt: null,
        result: 'success',
        hasAnswer: true,
        brandMentioned: false,
        provenance: 'retained-pulse-metric',
        limitations: [
          'model-unrecorded',
          'market-unrecorded',
          'collection-time-unrecorded',
        ],
      },
      limitations: ['one-recorded-response'],
      savedDraftId: null,
      savedState: 'unavailable',
      saveAvailability: 'available',
    },
  ],
}
export const draft: WorkItem = {
  id: '44444444-4444-4444-8444-444444444444',
  clientId,
  status: 'draft',
  title: 'Recorded title',
  action: 'Recorded action',
  notes: '',
  locale: 'en',
  revision: 1,
  createdAt: '2026-09-06T00:00:00Z',
  updatedAt: '2026-09-06T00:00:00Z',
  evidenceSnapshot: {
    schemaVersion: 1,
    source: initial.suggestions[0].source,
    ruleVersion: initial.suggestions[0].ruleVersion,
    evidence: {
      ...initial.suggestions[0].evidence,
      answerDigest: 'b'.repeat(64),
    } as WorkItem['evidenceSnapshot']['evidence'],
    limitations: initial.suggestions[0].limitations,
    titleKey: 'review-question-coverage',
    actionKey: 'review-question-coverage',
    args: initial.suggestions[0].args,
    locale: 'en',
    initialTitle: 'Original title',
    initialAction: 'Original action',
  },
}
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
const envelope = buildScanEvidence({
  requestedUrl: 'https://example.test/private?secret=1',
  evaluatedUrl: 'https://example.test/private',
  industry: 'general_b2b',
  region: 'HK',
  sitemapSource: 'unknown',
  checks: { c1_robots: { assessment: 'warn', collection: 'complete' } },
  collectedAt: '2026-09-02T10:00:00Z',
  observations: [],
})
export const scanSuggestion: OpportunityResponse['suggestions'][number] = {
  ...deriveSuggestions({
    kind: 'scan-check',
    scanId: '66666666-6666-4666-8666-666666666666',
    recordedAt: '2026-09-03T10:00:00Z',
    envelope,
  })[0],
  savedState: 'unsaved',
  saveAvailability: 'available',
}
