import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { initial, clientId, scanSuggestion, manyCandidates } from './c9c-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { writeC9cFixture } from './c9c-fixture-writer'
import { groupedCandidates, groupedConflict, blockedCandidates } from './c9c-group-fixtures'
export const htmlFor = (lang: string, data: typeof initial | null = initial, smeCopilot = false) =>
  renderToString(
    <NextIntlClientProvider
      timeZone="UTC"
      locale={lang}
      messages={lang === 'en' ? en : zh}
    >
      <OpportunityWorkspace
        clientId={clientId}
        smeCopilot={smeCopilot}
        {...(data
          ? { initial: data }
          : { initial: null, initialError: 'unavailable' as const })}
      />
    </NextIntlClientProvider>,
  )
describe('opportunity rendering', () => {
  it.each(['en', 'zh-HK'])('SME preserves returned group order and a blocked historical first group %s', lang => {
    const html = htmlFor(lang, groupedConflict, true), copy = (lang === 'en' ? en : zh).opportunities
    const first = html.slice(html.indexOf('<article'), html.indexOf('</article>'))
    expect(first).toContain('First retained question')
    expect(first).toContain(copy.groupHistoricalConflict)
    expect(first).not.toContain('<button')
    expect(html.indexOf('Second retained question')).toBeGreaterThan(html.indexOf(copy.sme.moreGroups))
    expect(html.indexOf(copy.sme.moreSuggestions)).toBeGreaterThan(html.indexOf('Second retained question'))
    const noGroups = htmlFor(lang, { ...groupedCandidates, groups: undefined }, true)
    expect(noGroups).not.toContain(copy.sme.moreGroups)
    expect(noGroups).not.toContain(copy.groupTitle)
  })
  it.each(['en', 'zh-HK'])('SME keeps a blocked first finding first, with other findings disclosed and evidence retained %s', lang => {
    const data = { ...initial, suggestions: [{ ...initial.suggestions[0], saveAvailability: 'limited-evidence' as const }, scanSuggestion] }
    const html = htmlFor(lang, data, true), copy = (lang === 'en' ? en : zh).opportunities
    expect(html).toContain(copy.sme.title)
    const first = html.indexOf('<article'), second = html.indexOf('<article', first + 1)
    const firstCard = html.slice(first, html.indexOf('</article>', first))
    expect(firstCard).toContain(copy.limitedEvidence)
    expect(firstCard).toContain('disabled=""')
    expect(firstCard).toContain(copy.sme.evidence)
    expect(firstCard).toContain(copy.pulseWhy)
    expect(second).toBeGreaterThan(html.indexOf(copy.sme.moreSuggestions))
    expect(html).toContain(copy.partial)
    expect(html).toContain(copy.savedUnknown)
    expect(html).toContain(copy.pulseTruncated)
    expect(html).toContain(copy.sme.window)
    expect(htmlFor(lang, data)).not.toContain(copy.sme.moreSuggestions)
  })
  it.each(['en', 'zh-HK'])('T19 describes FAQ content with a localized next step, without guessing a page %s', lang => {
    const suggestion = { ...scanSuggestion, source: { ...scanSuggestion.source, checkKey: 'c11_faq' as const }, args: { checkKey: 'c11_faq', assessment: 'fail' }, evidence: { ...scanSuggestion.evidence, checkKey: 'c11_faq' as const } }
    const html = htmlFor(lang, { ...initial, suggestions: [suggestion as typeof scanSuggestion] })
    expect(html).toContain(lang === 'en' ? 'Review frequently asked questions' : '檢查常見問題內容')
    expect(html.match(/<h2[^>]*>[^<]*c11_faq/)).toBeNull()
    expect(html).not.toContain('/private')
  })
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
    {
      smeGrouped: { props: { clientId, initial: groupedCandidates, smeCopilot: true }, html: lang => htmlFor(lang, groupedCandidates, true) },
      smeGroupedConflict: { props: { clientId, initial: groupedConflict, smeCopilot: true }, html: lang => htmlFor(lang, groupedConflict, true) },
      smeBlocked: { props: { clientId, initial: blockedCandidates, smeCopilot: true }, html: lang => htmlFor(lang, blockedCandidates, true) },
      sme: { props: { clientId, initial, smeCopilot: true }, html: lang => htmlFor(lang, initial, true) },
      smeMany: { props: { clientId, initial: manyCandidates, smeCopilot: true }, html: lang => htmlFor(lang, manyCandidates, true) },
      smeUnavailable: { props: { clientId, initial: null, initialError: 'unavailable', smeCopilot: true }, html: lang => htmlFor(lang, null, true) },
      continuation:{props:{clientId,initial:{...initial,window:{...initial.window,nextCursor:'next-evidence'}}},html:lang=>htmlFor(lang,{...initial,window:{...initial.window,nextCursor:'next-evidence'}})},
      many: { props:{clientId,initial:manyCandidates},html:lang=>htmlFor(lang,manyCandidates) },
      saved: {
        props: { clientId, initial: { ...initial, suggestions: initial.suggestions.map(row => ({ ...row, savedDraftId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', savedState: 'saved' as const })) } },
        html: (lang) => htmlFor(lang, { ...initial, suggestions: initial.suggestions.map(row => ({ ...row, savedDraftId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', savedState: 'saved' as const })) }),
      },
      unavailable: {
        props: { clientId, initial: null, initialError: 'unavailable' },
        html: (lang) => htmlFor(lang, null),
      },
    },
  ),
)
