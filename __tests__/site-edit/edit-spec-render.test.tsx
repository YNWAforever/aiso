import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { DraftEditor } from '@/components/work-items/DraftEditor'
import { VersionDetails } from '@/components/change-sets/VersionDetails'
import { parseEditSpec } from '@/lib/site-edit/edit-spec'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { draft, clientId } from '../components/c9c-fixtures'
import { version } from '../components/c9d-fixtures'

const spec = parseEditSpec({
  schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.example.com/faq', schemaType: 'FAQPage',
  payload: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Sourdough <daily>?' }] },
})

const render = (node: React.ReactNode, lang: string) => renderToString(
  <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>,
)

describe.each(['en', 'zh-HK'])('site-edit spec UI in %s', lang => {
  const opportunities = (lang === 'en' ? en : zh).opportunities
  const changeSets = (lang === 'en' ? en : zh).changeSets

  it('offers an unticked, collapsed site-edit section on a spec-less draft', () => {
    const html = render(<DraftEditor clientId={clientId} item={draft} onSaved={() => {}} />, lang)
    expect(html).toContain(opportunities.editSpecTitle)
    expect(html).toContain(opportunities.editSpecInclude)
    expect(html).not.toMatch(/<details[^>]*open/)
    expect(html).not.toContain(opportunities.editSpecPayload + '</label>')
  })

  it('shows the saved spec fields, escaped, on a draft that has one', () => {
    const html = render(<DraftEditor clientId={clientId} item={{ ...draft, editSpec: spec }} onSaved={() => {}} />, lang)
    expect(html).toMatch(/<details[^>]*open/)
    expect(html).toContain('value="https://www.example.com/faq"')
    expect(html).toContain('Sourdough &lt;daily&gt;?')
    expect(html).not.toContain('<daily>')
    expect(html).toContain(opportunities.editSpecRules)
  })

  it('shows the frozen spec on the version it was approved with, and nothing otherwise', () => {
    const withSpec = render(<VersionDetails version={{ ...version, editSpec: spec }} latestVersionId={version.id} />, lang)
    expect(withSpec).toContain(changeSets.editSpecTitle)
    expect(withSpec).toContain('https://www.example.com/faq')
    expect(withSpec).toContain('FAQPage')
    expect(withSpec).toContain('Sourdough &lt;daily&gt;?')
    const plain = render(<VersionDetails version={version} latestVersionId={version.id} />, lang)
    expect(plain).not.toContain(changeSets.editSpecTitle)
  })

  it('S9: edits and shows a meta spec: title and description, no JSON-LD fields', () => {
    const meta = parseEditSpec({ schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.example.com/menu', title: 'Menu & more', description: null })
    const editor = render(<DraftEditor clientId={clientId} item={{ ...draft, editSpec: meta }} onSaved={() => {}} />, lang)
    expect(editor).toContain('value="Menu &amp; more"')
    expect(editor).toContain(opportunities.editSpecPageTitle + '</label>')
    expect(editor).not.toContain(opportunities.editSpecPayload + '</label>')
    expect(editor).not.toContain(opportunities.editSpecRemove)
    const shown = render(<VersionDetails version={{ ...version, editSpec: meta }} latestVersionId={version.id} />, lang)
    expect(shown).toContain(changeSets.editSpecMetaTitle)
    expect(shown).toContain('https://www.example.com/menu')
    expect(shown).toContain('Menu &amp; more')
    expect(shown).toContain(changeSets.editSpecUnchanged) // the description is left as it is
    expect(shown).not.toContain('<pre')
  })
})
