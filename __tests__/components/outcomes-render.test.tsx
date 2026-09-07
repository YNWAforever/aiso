import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { OutcomeWindows } from '@/components/outcomes/OutcomeWindows'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
import { OUTCOME_REASON_CODES } from '@/lib/outcomes/types'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { outcomes } from './c9f-fixtures'
import { fixtureProps } from './c9e-fixtures'
import { writeC9cFixture } from './c9c-fixture-writer'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('server-only', () => ({}))
const render = (node: React.ReactNode, lang: string) => renderToString(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>)
describe('stored outcomes rendering', () => {
  it('requires exact bilingual keys and the full reason vocabulary', () => {
    expect(Object.keys(en.outcomes).sort()).toEqual(Object.keys(zh.outcomes).sort())
    expect(Object.keys(en.outcomes.reasons).sort()).toEqual([...OUTCOME_REASON_CODES].sort())
    expect(Object.keys(zh.outcomes.reasons).sort()).toEqual([...OUTCOME_REASON_CODES].sort())
    for (const key of ['anchorStates', 'timeStates', 'evidenceStates', 'sources', 'verdicts'] as const) expect(Object.keys(en.outcomes[key]).sort()).toEqual(Object.keys(zh.outcomes[key]).sort())
  })
  for (const [name, value] of Object.entries(outcomes)) it.each(['en', 'zh-HK'])(`${name} has valid wire data and honest localized output %s`, lang => {
    expect(parseOutcomeResponse(value)).toEqual(value)
    expect(value.contentHash).toBe(fixtureProps.initialVersion.contentHash)
    const html = render(<OutcomeWindows value={value} />, lang)
    expect(html).toContain(value.evaluatedAt)
    expect(html).toContain('UTC')
    expect(html).not.toMatch(/href=|text-green|bg-green|rawAnswer|undefined/)
    expect(html).not.toMatch(/>outcomes\.[a-z]/)
    if (value.anchor) { expect(html).toContain(value.anchor.id); expect(html).toContain('D56'); expect(html).toContain('.123456Z') }
    if (value.baseline) expect(html).toContain(value.baseline.source.id)
  })
  it('rejects malformed outcome fixture data', () => {
    expect(() => parseOutcomeResponse({ ...outcomes.scan, rawAnswer: 'forbidden' })).toThrow()
    expect(() => parseOutcomeResponse({ ...outcomes.scan, windows: [] })).toThrow()
  })
})
afterAll(async () => {
  await writeC9cFixture('C9F', 'VersionWorkspace', '@/components/change-sets/VersionWorkspace', fixtureProps,
    lang => render(<VersionWorkspace {...fixtureProps} />, lang), {}, 'outcomes')
})
