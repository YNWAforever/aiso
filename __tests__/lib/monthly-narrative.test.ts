import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const callOpenRouter = vi.hoisted(() => vi.fn())
vi.mock('@/lib/openrouter', () => ({ callOpenRouter }))

import { draftMonthlyNarrative, monthlyNarrativeFacts } from '@/lib/monthly-report/narrative'
import type { MonthlyReportSnapshotV2 } from '@/lib/monthly-report/snapshot'

const snapshot = {
  snapshotSchemaVersion: 2, kind: 'monthly', locale: 'en', month: '2026-11',
  period: { start: 'a', end: 'b' },
  branding: { agencyName: 'SECRET AGENCY', logoUrl: 'https://secret.example/logo.png', primaryColor: '#123ABC', contactLabel: null, contactUrl: 'https://secret.example', attribution: 'Powered by Fimmick AISO' },
  client: { name: 'SECRET CLIENT', domain: 'secret.example' },
  delivered: { verifiedLive: [{ title: 'Add FAQ schema', recordedAt: 'x', versionId: '1' }], selfReported: [{ title: 'Rewrote About', recordedAt: 'y', versionId: '2' }] },
  visibility: { state: 'recorded', rule: 1, minAnswersPerWeek: 5, minDelta: 0.5, platforms: [
    { platform: 'gpt-4o', opening: 10, closing: 14, delta: 4, direction: 'up', reason: null, weeks: 4 },
    { platform: 'gemini-flash', opening: 9, closing: 7, delta: -2, direction: 'down', reason: null, weeks: 4 },
    { platform: 'claude-haiku', opening: 5, closing: 5, delta: 0, direction: null, reason: 'no_clear_trend', weeks: 4 },
  ] },
  search: { opening: { state: 'not_connected' }, closing: { state: 'ok', from: '2026-10-01', through: '2026-10-31', days: 28, clicks: 120, impressions: 4500 } },
  nextMonth: { openWorkItems: [{ title: 'Add hours' }, { title: 'Fix schema' }] },
  executiveSummary: 'Current narrative.', builtAt: 'x',
} satisfies MonthlyReportSnapshotV2

const facts = monthlyNarrativeFacts(snapshot, 'zh-HK')

describe('monthly narrative facts', () => {
  it('carries only stored facts, never branding, client identity or raw URLs', () => {
    expect(facts).toEqual({
      locale: 'zh-HK', month: '2026-11', currentNarrative: 'Current narrative.',
      delivered: { verifiedLive: 1, selfReported: 1 },
      visibility: { state: 'recorded', rising: 1, falling: 1, platforms: 3 },
      search: { state: 'recorded', clicks: 120, impressions: 4500 },
      openItems: 2,
    })
    const json = JSON.stringify(facts)
    for (const leak of ['SECRET', 'secret.example', 'logo', '#123ABC']) expect(json).not.toContain(leak)
  })

  it('names missing figure states instead of zeroes', () => {
    const missing = monthlyNarrativeFacts({
      ...snapshot,
      visibility: { state: 'not_enough_data', reason: 'no_pulse_data' },
      search: { opening: { state: 'not_connected' }, closing: { state: 'not_recorded' } },
    }, 'en')
    expect(missing.visibility).toEqual({ state: 'not_enough_data', rising: 0, falling: 0, platforms: 0 })
    expect(missing.search).toEqual({ state: 'not_connected', clicks: null, impressions: null })
  })
})

describe('draftMonthlyNarrative', () => {
  beforeEach(() => callOpenRouter.mockReset())

  it('sends the facts to one bounded request and returns the polished wording', async () => {
    callOpenRouter.mockResolvedValue('This month 1 change went live and 1 was self reported, with 2 open items carried into next month.')
    expect(await draftMonthlyNarrative(facts)).toEqual({
      narrative: 'This month 1 change went live and 1 was self reported, with 2 open items carried into next month.',
      polished: true, code: 'ai_polished',
    })
    const options = callOpenRouter.mock.calls[0]?.[0]
    expect(options.label).toBe('monthly_report.narrative_draft')
    expect(options.maxTokens).toBe(450)
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.messages[1].content).toContain('"verifiedLive":1')
    expect(options.messages[0].content).toContain('Traditional Chinese')
  })

  it.each([
    ['an invented figure', 'The brand gained 999 clicks and 12 changes this month.'],
    ['a percentage', 'Share of voice improved to 14% this month, with 1 change live.'],
    ['markup', '## Heading\nSomething changed this month with 1 change live and 2 open items.'],
    ['a competitor claim', 'The brand beat its competitors this month with 1 change live and 2 open items.'],
  ])('refuses %s and falls back to the stored narrative', async (_label, reply) => {
    callOpenRouter.mockResolvedValue(reply)
    expect(await draftMonthlyNarrative(facts)).toEqual({ narrative: 'Current narrative.', polished: false, code: 'ai_invalid_output' })
  })

  it('falls back when the provider fails, without throwing', async () => {
    callOpenRouter.mockImplementationOnce(async () => { throw new Error('provider unavailable') })
    expect(await draftMonthlyNarrative(facts)).toEqual({ narrative: 'Current narrative.', polished: false, code: 'ai_unavailable' })
  })
})
