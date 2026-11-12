import { describe, expect, it } from 'vitest'
import { hongKongMonthKey, scanUrlFor, studioActionBlocker, STUDIO_ACTION_WRITES } from '@/lib/conversation-studio/skill-actions'

const allFeatures = {
  plan: 'pro' as const,
  platform_access: ['chatgpt'],
  agent_recs: true,
  agent_progress: true,
  agent_competitors: true,
  alerts: true,
  csv_export: true,
  max_brands: 5,
  history_weeks: 26,
  edit_prompts: true,
  local_trust_roi: true,
  local_trust_competitors: true,
  local_trust_export: true,
  client_reports_online: true,
}

describe('Studio action skill gates', () => {
  it('asks for the brand domain before a scan', () => {
    expect(studioActionBlocker({ skillId: 'scan_brand', brandDomain: null, latestScanId: null, features: allFeatures })).toBe('needsDomain')
    expect(studioActionBlocker({ skillId: 'scan_brand', brandDomain: 'fotomax.com', latestScanId: null, features: allFeatures })).toBeNull()
  })

  it('asks for a completed scan before generating suggestions', () => {
    expect(studioActionBlocker({ skillId: 'improve_page', brandDomain: 'fotomax.com', latestScanId: null, features: allFeatures })).toBe('needsScan')
    expect(studioActionBlocker({ skillId: 'improve_page', brandDomain: 'fotomax.com', latestScanId: 'scan-1', features: allFeatures })).toBeNull()
  })

  it('fails closed on the plan instead of trusting the browser', () => {
    expect(studioActionBlocker({ skillId: 'improve_page', brandDomain: 'fotomax.com', latestScanId: 'scan-1', features: { ...allFeatures, agent_recs: false } })).toBe('planRequired')
    expect(studioActionBlocker({ skillId: 'monthly_report', brandDomain: null, latestScanId: null, features: { ...allFeatures, client_reports_online: false } })).toBe('planRequired')
    expect(studioActionBlocker({ skillId: 'monthly_report', brandDomain: null, latestScanId: null, features: undefined })).toBe('planRequired')
    expect(studioActionBlocker({ skillId: 'monthly_report', brandDomain: null, latestScanId: null, features: allFeatures })).toBeNull()
  })

  it('never gates a skill that has no action', () => {
    expect(studioActionBlocker({ skillId: 'draft_brief', brandDomain: null, latestScanId: null, features: undefined })).toBeNull()
  })
})

describe('Studio action helpers', () => {
  it('turns a saved bare domain into an absolute scan URL without doubling the scheme', () => {
    expect(scanUrlFor('fotomax.com')).toBe('https://fotomax.com')
    expect(scanUrlFor('https://fotomax.com')).toBe('https://fotomax.com')
    expect(scanUrlFor('http://fotomax.com')).toBe('http://fotomax.com')
  })

  it('records the Hong Kong calendar month, not the UTC one', () => {
    // 16:30 UTC on 30 Nov is 00:30 HKT on 1 Dec.
    expect(hongKongMonthKey(new Date('2026-11-30T16:30:00Z'))).toBe('2026-12')
    expect(hongKongMonthKey(new Date('2026-11-12T20:00:00Z'))).toBe('2026-11')
    expect(hongKongMonthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
  })

  it('describes exactly the three existing writes', () => {
    expect(Object.keys(STUDIO_ACTION_WRITES)).toEqual(['scan', 'improve', 'report'])
    expect(STUDIO_ACTION_WRITES.scan).toContain('scan')
    expect(STUDIO_ACTION_WRITES.improve).toContain('drafts')
    expect(STUDIO_ACTION_WRITES.report).toContain('month record')
  })
})
