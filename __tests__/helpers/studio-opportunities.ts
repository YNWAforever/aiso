import type { StudioOpportunities } from '@/lib/conversation-studio/types'

export const emptyStudioOpportunities: StudioOpportunities = {
  state: 'empty',
  suggestions: [],
  partial: false,
  pulseWeek: null,
  sourceStates: { pulse: 'empty', scan: 'empty' },
}

export const pendingStudioOpportunities: StudioOpportunities = {
  state: 'pending',
  suggestions: [],
  partial: true,
  pulseWeek: null,
  sourceStates: { pulse: 'unavailable', scan: 'unavailable' },
}

export const savedStudioOpportunities: StudioOpportunities = {
  state: 'ready',
  partial: false,
  pulseWeek: '2026-10-26',
  sourceStates: { pulse: 'ok', scan: 'ok' },
  suggestions: [
    {
      key: 'pulse-fixture-opportunity',
      title: 'Review question coverage',
      action: 'Review content relevant to “Which bakery offers sourdough?”. The retained ChatGPT answer did not mention the brand.',
      recordedAt: '2026-10-27T03:00:00Z',
      evidenceRefs: [{ kind: 'pulse-metric', id: '30000000-0000-4000-8000-000000000001' }],
      source: { kind: 'pulse-metric', id: '30000000-0000-4000-8000-000000000001' },
      ruleVersion: 'pulse-brand-absent.v1',
      fingerprint: 'a'.repeat(64),
      savedDraftId: null,
      savedState: 'unsaved',
      saveAvailability: 'available',
    },
    {
      key: 'scan-fixture-opportunity',
      title: 'Review frequently asked questions',
      action: 'Add clear FAQ content for the buying questions the page does not answer.',
      recordedAt: '2026-10-26T00:00:00Z',
      evidenceRefs: [{ kind: 'scan-check', id: '40000000-0000-4000-8000-000000000001', checkKey: 'c11_faq' }],
      source: { kind: 'scan-check', id: '40000000-0000-4000-8000-000000000001', checkKey: 'c11_faq' },
      ruleVersion: 'scan-check-gap.v1',
      fingerprint: 'b'.repeat(64),
      savedDraftId: null,
      savedState: 'unsaved',
      saveAvailability: 'available',
    },
  ],
}
