import { afterAll, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import { draft, clientId } from './c9c-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { writeC9cFixture } from './c9c-fixture-writer'
const htmlFor = (lang: string, smeCopilot = false) =>
  renderToString(
    <NextIntlClientProvider
      timeZone="UTC"
      locale={lang}
      messages={lang === 'en' ? en : zh}
    >
      <main>
        <h1>Draft fixture</h1>
        <DraftEditor clientId={clientId} item={draft} smeCopilot={smeCopilot} onSaved={() => {}} />
      </main>
    </NextIntlClientProvider>,
  )
describe('draft rendering', () => {
  it.each(['en', 'zh-HK'])(
    'preserves saved locale, original snapshot and labelled editable fields in %s',
    (lang) => {
      const html = htmlFor(lang),
        copy = (lang === 'en' ? en : zh).opportunities
      for (const value of [
        copy.notes,
        copy.action,
        copy.titleField,
        copy.snapshotNotice,
        'Recorded title',
        'Original title',
        'Original action',
        'English',
      ])
        expect(html).toContain(value)
      expect(html).toContain(
        'Historical &lt;script&gt;alert(1)&lt;/script&gt; 問題',
      )
      expect(html).not.toContain('bbbbbbbbbbbb')
    },
  )
  it.each(['en', 'zh-HK'])('SME exposes saved review navigation and keeps evidence/metadata in native disclosures in %s', lang => {
    const copy = (lang === 'en' ? en : zh).opportunities, html = htmlFor(lang, true)
    expect(html).toContain(copy.sme.editDraft)
    expect(html).toContain(copy.sme.prepareReview)
    expect(html).toContain(`href="/${lang}/dashboard/${clientId}/work-items/${draft.id}/versions"`)
    expect(html).toContain(copy.pulseUnknowns)
    expect(html.indexOf(copy.pulseUnknowns)).toBeLessThan(html.indexOf('<form'))
    const evidence = html.slice(html.lastIndexOf('<details', html.indexOf(copy.savedEvidence)), html.indexOf(copy.savedEvidence))
    expect(evidence).toContain('<summary')
    expect(evidence).not.toContain('open=""')
    expect(html).toContain(copy.sme.recordingDetails)
    expect(html).toContain('Original title')
    expect(html).toContain(copy.snapshotNotice)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/)
    expect(htmlFor(lang)).not.toContain(copy.sme.prepareReview)
  })

  it('keeps bilingual catalog keys equal', () =>
    expect(Object.keys(en.opportunities).sort()).toEqual(
      Object.keys(zh.opportunities).sort(),
    ))
})
afterAll(() =>
  writeC9cFixture(
    'C9C_DRAFT',
    'DraftEditor',
    '@/components/work-items/DraftEditor',
    { clientId, item: draft },
    htmlFor,
    { sme: { props: { clientId, item: draft, smeCopilot: true }, html: lang => htmlFor(lang, true) } },
  ),
)
