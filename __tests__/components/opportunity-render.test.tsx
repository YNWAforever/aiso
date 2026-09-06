import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { initial, clientId, scanSuggestion } from './c9c-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { writeC9cFixture } from './c9c-fixture-writer'
export const htmlFor = (lang: string, data = initial) =>
  renderToString(
    <NextIntlClientProvider
      timeZone="UTC"
      locale={lang}
      messages={lang === 'en' ? en : zh}
    >
      <OpportunityWorkspace clientId={clientId} initial={data} />
    </NextIntlClientProvider>,
  )
describe('opportunity rendering', () => {
  it.each(['en', 'zh-HK'])(
    'renders escaped full source and distinct partial/saved states in %s',
    (lang) => {
      const html = htmlFor(lang),
        copy = (lang === 'en' ? en : zh).opportunities
      for (const value of [
        copy.partial,
        copy.savedUnknown,
        copy.pulseTruncated,
        copy.unknownRecordedAt,
        copy.pulseWhy,
      ])
        expect(html).toContain(value)
      expect(html).toContain(
        'Historical &lt;script&gt;alert(1)&lt;/script&gt; 問題',
      )
      expect(html).not.toContain('<script>alert')
    },
  )
  it.each(['en', 'zh-HK'])(
    'renders scan provenance and preserves redaction in %s',
    (lang) => {
      const html = htmlFor(lang, { ...initial, suggestions: [scanSuggestion] }),
        copy = (lang === 'en' ? en : zh).opportunities
      for (const text of [
        copy.scanWhy,
        copy.redacted,
        copy.methods,
        'c1_robots',
        '2026-09-02T10:00:00.000Z',
        'https://example.test',
      ])
        expect(html).toContain(text)
      expect(html).not.toContain('/private')
      expect(html).not.toContain('secret=')
    },
  )
  it('disables limited evidence separately from an unknown saved lookup', () => {
    const html = htmlFor('en', {
      ...initial,
      suggestions: [
        { ...initial.suggestions[0], saveAvailability: 'limited-evidence' },
      ],
    })
    expect(html).toContain(en.opportunities.limitedEvidence)
    expect(html).toContain('disabled=""')
    expect(html).toContain(en.opportunities.savedUnknown)
  })
  it('only claims healthy empty when all source reads succeed', () => {
    expect(htmlFor('en', { ...initial, suggestions: [] })).not.toContain(
      en.opportunities.empty,
    )
    expect(
      htmlFor('en', {
        ...initial,
        partial: false,
        suggestions: [],
        sourceStates: { pulse: 'empty', scan: 'empty' },
        savedDraftsState: 'ok',
      }),
    ).toContain(en.opportunities.empty)
  })
})
afterAll(() =>
  writeC9cFixture(
    'C9C',
    'OpportunityWorkspace',
    '@/components/opportunities/OpportunityWorkspace',
    { clientId, initial },
    htmlFor,
  ),
)
