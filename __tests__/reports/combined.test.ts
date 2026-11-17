import { describe, expect, it } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { buildCombinedPulseView, buildCombinedScanView } from '@/lib/reports/combined-view'
import type { ShareOfVoiceView } from '@/lib/pulse/share-of-voice'

const scanResults = {
  evidence: buildScanEvidence({
    requestedUrl: 'https://example.com',
    evaluatedUrl: 'https://example.com',
    industry: null,
    region: null,
    sitemapSource: 'fetched',
    observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }],
    checks: {
      c1_robots: { assessment: 'fail', collection: 'complete' },
      c2_llms_txt: { assessment: 'pass', collection: 'complete' },
    },
  }),
  c1_robots: { status: 'fail', message: 'robots_ai_blocked' },
  c2_llms_txt: { status: 'pass', message: 'llms_txt_present' },
}

function scanSource(overrides: Partial<Parameters<typeof buildCombinedScanView>[0]> = {}) {
  return {
    id: 'scan-1',
    domain: 'example.com',
    createdAt: '2026-11-17T15:03:59.776Z',
    score: 48,
    grade: 'F',
    results: scanResults,
    accountId: 'account-1',
    ...overrides,
  }
}

function sovView(overrides: Partial<ShareOfVoiceView> = {}): ShareOfVoiceView {
  return {
    weeks: ['2026-11-10', '2026-11-03'],
    platforms: ['gpt-4o', 'gemini-flash'],
    subjects: [{
      kind: 'brand',
      label: 'Example Brand',
      change: 4.2,
      cells: {
        '2026-11-10': {
          '*': { mentions: 3, answers: 6, share: 50 },
          'gpt-4o': { mentions: 2, answers: 3, share: 66.7 },
          'gemini-flash': { mentions: 1, answers: 3, share: 33.3 },
        },
        '2026-11-03': { '*': { mentions: 2, answers: 5, share: 40 } },
      },
    }],
    prompts: [
      { promptId: 'p1', question: 'What should I eat?', answers: 6, brandMentions: 3, competitors: [] },
    ],
    ...overrides,
  }
}

describe('combined report scan section', () => {
  it('uses the latest scan and surfaces only confirmed fail/warn fixes', () => {
    const view = buildCombinedScanView(scanSource(), 'en')
    expect(view).toMatchObject({ state: 'recorded', scanId: 'scan-1', score: 48, grade: 'F' })
    if (view.state !== 'recorded') throw new Error('expected recorded scan')
    expect(view.checks).toHaveLength(20)
    expect(view.checks.find(check => check.key === 'c1_robots')?.status).toBe('fail')
    expect(view.checks.find(check => check.key === 'c2_llms_txt')?.status).toBe('pass')
    expect(view.issues).toEqual([
      expect.objectContaining({ key: 'c1_robots', status: 'fail', title: 'Review crawler rules' }),
    ])
    expect(JSON.stringify(view)).not.toMatch(/AISO/i)
    expect(JSON.stringify(view)).not.toContain('robots_ai_blocked')
  })

  it('never turns an unscorable or unreadable scan into a score', () => {
    expect(buildCombinedScanView(scanSource({ score: null }), 'en')).toEqual({ state: 'unscored' })
    expect(buildCombinedScanView(scanSource({ results: null }), 'en')).toEqual({ state: 'unavailable' })
    const failedEvidence = buildScanEvidence({
      requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: null, region: null,
      sitemapSource: 'unknown', checks: {},
      observations: [{ check: 'page', collection: 'failed', httpStatus: 503, target: { origin: 'https://example.com' } }],
    })
    expect(buildCombinedScanView(scanSource({ results: { ...scanResults, evidence: failedEvidence } }), 'en'))
      .toEqual({ state: 'unscored' })
  })
})

describe('combined report Pulse section', () => {
  it('reads the latest classified week, platform cells and question rows', () => {
    const view = buildCombinedPulseView(sovView())
    expect(view).toMatchObject({ state: 'recorded', week: '2026-11-10', answers: 6, brandMentions: 3, brandShare: 50 })
    if (view.state !== 'recorded') throw new Error('expected recorded pulse')
    expect(view.platforms).toEqual([
      { key: 'gpt-4o', answers: 3, mentions: 2, share: 66.7 },
      { key: 'gemini-flash', answers: 3, mentions: 1, share: 33.3 },
    ])
    expect(view.prompts).toEqual([{ question: 'What should I eat?', answers: 6, brandMentions: 3 }])
    expect(JSON.stringify(view)).not.toMatch(/AISO/i)
  })

  it('keeps no data distinct from zero mentions and from an unreadable read', () => {
    expect(buildCombinedPulseView(sovView({ weeks: [], platforms: [], subjects: [], prompts: [] }))).toEqual({ state: 'none' })
    expect(buildCombinedPulseView(sovView({
      weeks: ['2026-11-10'], platforms: [], subjects: [{ kind: 'brand', label: 'Example Brand', change: null, cells: {} }], prompts: [],
    }))).toEqual({ state: 'unavailable' })
  })
})
