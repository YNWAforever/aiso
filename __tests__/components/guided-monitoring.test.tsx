import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuidedRunProgress } from '@/components/pulse/GuidedRunProgress'
import type { readUserPulseOptions, UserPulseRun } from '@/lib/pulse/runs/user-dispatch'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

type Options = Awaited<ReturnType<typeof readUserPulseOptions>>
const options = { prompts: 2, variants: 5, expected: 10, contextConfirmed: true, enabled: true, week: '2026-11-09', remaining: 20, currentCanonicalId: null, latest: null, legacyCurrentWeek: false, legacyObservationIds: [], search: { requested: 'off' } } as unknown as Options
const run: UserPulseRun = { id: 'saved', week: '2026-11-09', purpose: 'canonical', sourceRunId: null, coverage: { expected: 10, succeeded: 3, classified: 2, mentioned: 0, failed: 0, pending: 7, blocked: 0, status: 'partial', coverage: 0.3, mentionRate: 0 }, reasons: ['classification_pending'], retryable: true, observedAt: null }
const render = (lang: string, patch: Partial<Parameters<typeof GuidedRunProgress>[0]> = {}) => renderToStaticMarkup(<GuidedRunProgress clientId="owned" lang={lang} brandName="Example brand" options={options} run={null} error={null} busy={false} repairOutcome={null} refresh={vi.fn()} start={vi.fn()} repair={vi.fn()} {...patch} />)

describe('guided monitoring', () => {
  it.each(['en', 'zh-HK'])('starts with one clear action and collapsed technical detail in %s', lang => {
    const c = (lang === 'en' ? en : zh).runProgress.sme
    const html = render(lang)
    expect(html).toContain(c.ready)
    expect(html).toContain(c.start)
    expect(html).toContain('Example brand')
    expect(html.indexOf(c.start)).toBeLessThan(html.indexOf('<details'))
    expect(html).not.toContain(c.confirmTitle)
    expect(html).not.toContain('disabled=""')
  })
  it.each(['en', 'zh-HK'])('keeps pause distinct from empty answers in %s', lang => {
    const c = (lang === 'en' ? en : zh).runProgress.sme
    const html = render(lang, { options: { ...options, enabled: false } })
    expect(html.split(c.paused)).toHaveLength(2)
    expect(html.split(`>${(lang === 'en' ? en : zh).runProgress.refresh}</button>`)).toHaveLength(2)
    expect(html).not.toContain(`>${c.start}</button>`)
    for (const patch of [
      { contextConfirmed: false, remaining: 0, expected: 10 },
      { contextConfirmed: false, prompts: 0, variants: 0, expected: 0 },
    ]) {
      const blocked = render(lang, { options: { ...options, enabled: false, ...patch } })
      expect(blocked).toContain(c.paused)
      expect(blocked).toContain(c.blockers.context_missing)
      if (patch.remaining === 0) expect(blocked).toContain(c.blockers.quota_exceeded)
      if (patch.prompts === 0) {
        expect(blocked).toContain(c.blockers.no_prompts)
        expect(blocked).toContain(c.blockers.no_models)
      }
    }
  })
  it('shows saved partial counts, source-scoped results and honest reasons', () => {
    const html = render('en', { options: { ...options, currentCanonicalId: 'saved' }, run })
    expect(html).toContain('3 of 10 expected answers saved')
    expect(html).toContain('Brand checked in 2 of 3 saved answers')
    expect(html).toContain('/observations?run=saved&amp;week=2026-11-09')
    expect(html).toContain(en.runProgress.reasons.classification_pending)
    expect(html).not.toContain('10 of 10')
  })
  it('keeps failed reads unavailable rather than presenting zero or executable actions', () => {
    const html = render('en', { options: null, error: en.runProgress.unavailable })
    expect(html).toContain('role="alert"')
    expect(html).not.toContain(en.runProgress.sme.start)
    expect(html).not.toContain('0 of 0')
  })
})
