import type { StudioEvidence } from '@/lib/conversation-studio/types'

export const emptyStudioEvidence: StudioEvidence = {
  week: null, totalRecorded: 0, truncated: false, observations: [], scan: null,
}
export const savedStudioScan: StudioEvidence['scan'] = {
  id: '40000000-0000-4000-8000-000000000001', recordedAt: '2026-10-27T01:00:00Z',
  evidence: { collection: 'partial', completedPages: 1, collectedAt: '2026-10-27T00:00:00Z', limited: true,
    scannerVersion: 'fixture.v1', methodologyVersion: 'fixture.v1', pillarInputs: {},
    checks: [{ key: 'c1_robots', collection: 'complete', assessment: 'pass' }] },
}
export const savedStudioEvidence: StudioEvidence = {
  week: '2026-10-26', totalRecorded: 1, truncated: false,
  observations: [{
    id: '30000000-0000-4000-8000-000000000001', question: 'Which bakery offers sourdough?',
    platform: 'chatgpt', scanWeek: '2026-10-26', recordedAt: '2026-10-27T03:00:00Z',
    collectedAt: null, model: null, market: null, result: 'success', brandMentioned: true,
    excerpt: 'Example Brand offers sourdough. This is a historical model answer.',
    links: [{ url: 'https://example.com/bread', title: 'Bread', kind: 'provider-citation' }],
    searchEvidence: { requested: 'web', execution: 'unknown', basis: 'request-only' },
  }],
  scan: null,
}
