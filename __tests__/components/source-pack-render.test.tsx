import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SourcePackWorkspace } from '@/components/sources/SourcePackWorkspace'
import { buildSourcePack } from '@/lib/view-models/source-pack'
import type { SourceDto } from '@/lib/sources/schema'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('server-only', () => ({}))
// The component asks the server to re-render after a write rather than patching
// local state; SSR only needs the hook to exist.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

/**
 * What an owner is told about the facts a draft may quote.
 *
 * The lie this surface has to be incapable of telling: showing a source as
 * ready when the server will never cite it. Three conditions gate that, and an
 * owner who switched agent use on will reasonably believe the switch was the
 * whole story — so the case that matters most here is "toggle on, never
 * approved".
 */

const NOW = new Date('2026-09-10T00:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const clientId = '11111111-1111-4111-8111-111111111111'

function source(over: Partial<SourceDto> = {}, version: Partial<NonNullable<SourceDto['current']>> = {}): SourceDto {
  return {
    id: 'src-1', sourceKey: 'brand-facts', kind: 'facts', label: 'Brand facts',
    agentUseAllowed: true, revokedAt: null, latestVersion: 2,
    freshness: 'current', updatedAt: daysAgo(1),
    current: {
      id: 'ver-1', versionNumber: 2, contentHash: 'a'.repeat(64), importMethod: 'paste',
      originRef: null, importedAt: daysAgo(1), approvedAt: daysAgo(1),
      entries: [{ question: 'What are your hours?', answer: '9 to 6' }],
      ...version,
    },
    ...over,
  }
}

const copyFor = (lang: string) => (lang === 'zh-HK' ? zh : en).sources

const render = (sources: SourceDto[], lang: string) => renderToString(
  <NextIntlClientProvider locale={lang} messages={lang === 'zh-HK' ? zh : en} timeZone="UTC">
    <SourcePackWorkspace clientId={clientId} pack={buildSourcePack(sources, NOW)} />
  </NextIntlClientProvider>,
)

const renderFailed = (lang: string) => renderToString(
  <NextIntlClientProvider locale={lang} messages={lang === 'zh-HK' ? zh : en} timeZone="UTC">
    <SourcePackWorkspace clientId={clientId} pack={null} loadFailed />
  </NextIntlClientProvider>,
)

describe.each(['en', 'zh-HK'])('the source pack in %s', lang => {
  const copy = copyFor(lang)

  it.each([
    ['in-use', {}, {}],
    ['awaiting-approval', {}, { approvedAt: null }],
    ['not-permitted', { agentUseAllowed: false }, {}],
    ['revoked', { revokedAt: daysAgo(1) }, {}],
  ] as const)('labels a %s source and says why', (usability, over, version) => {
    const html = render([source(over, version)], lang)

    expect(html).toContain(copy.usability[usability])
    expect(html).toContain(copy.why[usability])
  })

  it('does not present an unapproved source as in use, however the toggle is set', () => {
    // The whole point. An owner who switched agent use on has changed nothing
    // while the version is unapproved, and must be told so.
    const html = render([source({ agentUseAllowed: true }, { approvedAt: null })], lang)

    expect(html).toContain(copy.why['awaiting-approval'])
    expect(html).not.toContain(copy.why['in-use'])
  })

  it('states that an import is not a connection', () => {
    expect(render([source()], lang)).toContain(copy.notConnected)
  })

  it('states that imported text is data and not instruction', () => {
    expect(render([source()], lang)).toContain(copy.untrusted)
  })

  it('keeps a stale source in use and explains the age instead of hiding it', () => {
    const html = render([source({}, { importedAt: daysAgo(400) })], lang)

    expect(html).toContain(copy.why['in-use'])
    expect(html).toContain(copy.freshness.staleNote)
  })

  it('shows the version and hash a citation would name', () => {
    expect(render([source()], lang)).toContain('a'.repeat(12))
  })

  it('offers no controls on a revoked source, because none of them would do anything', () => {
    // Scoped to the card: the page header legitimately names the same actions
    // while explaining the gate, and the import form has its own buttons.
    const card = (sources: SourceDto[]) => render(sources, lang).match(/<ul class="mt-6[\s\S]*?<\/ul>/)![0]

    expect(card([source()])).toContain('<button')
    expect(card([source({ revokedAt: daysAgo(1) })])).not.toContain('<button')
    expect(card([source({ revokedAt: daysAgo(1) })])).toContain(copy.why.revoked)
  })

  it('distinguishes "nothing imported" from "could not load"', () => {
    // An empty list rendered over a failed read would tell an owner their facts
    // are gone.
    const empty = render([], lang)
    const failed = renderFailed(lang)

    expect(empty).toContain(copy.states.empty)
    expect(empty).not.toContain(copy.states.error)
    expect(failed).toContain(copy.states.error)
    expect(failed).not.toContain(copy.states.empty)
  })

  it('escapes imported text rather than rendering it as markup', () => {
    const html = render([source({ label: '<script>alert(1)</script>' })], lang)

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('gives every control a touch-sized target', () => {
    // Review and approval happen on a phone; a 24px button is not reviewable.
    const html = render([source()], lang)
    const controls = html.match(/<(?:button|input|select|textarea)[^>]*>/g) ?? []

    expect(controls.length).toBeGreaterThan(4)
    for (const control of controls) {
      if (/type="checkbox"/.test(control)) continue
      expect(control).toMatch(/min-h-11|h-5/)
    }
  })
})

describe('bilingual equivalence', () => {
  const keysOf = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, child]) => keysOf(child, `${prefix}${key}.`))
      : [prefix.slice(0, -1)]

  it('declares identical keys in both catalogues', () => {
    expect(keysOf(copyFor('zh-HK')).sort()).toEqual(keysOf(copyFor('en')).sort())
  })

  it('renders a different string for the same state in each language', () => {
    // A missing translation falling back to English would pass a "contains"
    // check in both languages; this is what catches it.
    expect(copyFor('en').states.empty).not.toBe(copyFor('zh-HK').states.empty)
    expect(render([], 'en')).toContain(copyFor('en').states.empty)
    expect(render([], 'zh-HK')).toContain(copyFor('zh-HK').states.empty)
  })

  it('translates every error code the service can emit', () => {
    // The service returns codes precisely so the UI can localise them; a code
    // with no message would surface as the generic dependency failure and
    // mislead. Read from the source rather than a hand-kept list, so a new code
    // fails here instead of shipping untranslated.
    const codes = new Set<string>()
    for (const file of ['lib/sources/schema.ts', 'lib/sources/service.ts']) {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8')
      for (const match of text.matchAll(/'(SOURCES?_[A-Z0-9_]+)'/g)) codes.add(match[1]!)
    }

    expect(codes.size).toBeGreaterThan(10)
    for (const lang of ['en', 'zh-HK']) {
      const table = copyFor(lang).errors as Record<string, string>
      for (const code of codes) expect(table[code], `${code} in ${lang}`).toBeTruthy()
    }
  })
})
