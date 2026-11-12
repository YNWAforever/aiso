import { describe, expect, it } from 'vitest'
import { smeTabState } from '@/lib/sme-tabs'

const base = '/en/dashboard/11111111-1111-4111-8111-111111111111'

describe('SME section tabs', () => {
  it('places a brand step page under the right destination and marks the active tab', () => {
    expect(smeTabState({ base, segment: '', step: 'monitor' })).toMatchObject({ section: 'what_ai_says', active: 'visibility' })
    expect(smeTabState({ base, segment: '', step: 'scan' })).toMatchObject({ section: 'improve', active: 'scan' })
    expect(smeTabState({ base, segment: '', step: 'results' })).toMatchObject({ section: 'improve', active: 'results' })
    expect(smeTabState({ base, segment: '', step: 'improve' })).toMatchObject({ section: 'improve', active: 'suggestions' })
  })

  it('keeps every tab on an existing route so consolidation needs no redirect', () => {
    const what = smeTabState({ base, segment: 'observations', step: null })
    expect(what?.tabs.map(tab => tab.href)).toEqual([
      `${base}?step=monitor`, `${base}/observations`, `${base}/citations`, `${base}/competitors`, `${base}/prompts`,
    ])
    const improve = smeTabState({ base, segment: 'tasks', step: null })
    expect(improve?.tabs.map(tab => tab.href)).toEqual([
      `${base}?step=scan`, `${base}?step=results`, `${base}?step=improve`, `${base}/tasks`,
    ])
  })

  it('maps the page URLs to the same destination as their canonical tab URL', () => {
    expect(smeTabState({ base, segment: 'opportunities', step: null })).toMatchObject({ section: 'improve', active: 'suggestions' })
    expect(smeTabState({ base, segment: 'prompts', step: null })).toMatchObject({ section: 'what_ai_says', active: 'questions' })
    expect(smeTabState({ base, segment: 'citations', step: null })).toMatchObject({ active: 'citations' })
    expect(smeTabState({ base, segment: 'competitors', step: null })).toMatchObject({ active: 'competitors' })
  })

  it('never adds tabs to Today, Reports, account pages or unknown steps', () => {
    for (const input of [
      { base, segment: '', step: null },
      { base, segment: '', step: 'home' },
      { base, segment: '', step: 'overview' },
      { base, segment: '', step: 'roi' },
      { base, segment: '', step: 'settings' },
      { base, segment: 'reports', step: null },
      { base, segment: 'this-month', step: null },
      { base, segment: 'studio', step: null },
      { base, segment: 'entities', step: null },
    ]) expect(smeTabState(input)).toBeNull()
  })
})
