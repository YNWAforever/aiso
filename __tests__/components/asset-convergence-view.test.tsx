import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssetConvergenceView } from '@/components/dashboard/AssetConvergenceView'
import type { AssetConvergence } from '@/lib/view-models/asset-convergence'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

/**
 * The registered-pages screen.
 *
 * The assertion that matters most is the scope line. A scan observed the site,
 * not the page, and this screen lists site findings underneath a page heading —
 * so it must say which it is. Without that sentence the layout itself becomes
 * the claim that the finding was observed on that page, which is evidence the
 * product never collected.
 */

const LANGS = ['en', 'zh-HK'] as const
const copyFor = (lang: (typeof LANGS)[number]) => (lang === 'zh-HK' ? zhHK : en)

const entry = (overrides: Partial<AssetConvergence> = {}): AssetConvergence => ({
  asset: { id: 'asset-1', url: 'https://example.com/pricing', origin: 'https://example.com', label: 'Pricing' },
  findings: [{ checkKey: 'c9_meta_desc', status: 'fail', scope: 'site' }],
  questions: [{ promptId: 'prompt-1', question: 'Do you offer annual billing?', scope: 'page' }],
  converges: true,
  ...overrides,
})

const render = (convergence: AssetConvergence[], lang: (typeof LANGS)[number] = 'en') =>
  renderToStaticMarkup(<AssetConvergenceView convergence={convergence} lang={lang} clientId="client-1" />)

describe('the registered pages screen', () => {
  it.each(LANGS)('says a finding was observed for the site, not the page (%s)', lang => {
    const markup = render([entry()], lang)

    expect(markup).toContain(copyFor(lang).assets.findingsScope)
  })

  it.each(LANGS)('attributes a declared question to the owner (%s)', lang => {
    const markup = render([entry()], lang)

    expect(markup).toContain(copyFor(lang).assets.questionsScope)
  })

  it('states convergence only when both kinds reached the page', () => {
    expect(render([entry()])).toContain(en.assets.converges)
    expect(render([entry({ questions: [], converges: false })])).not.toContain(en.assets.converges)
  })

  it('shows the page, its address, the finding and the question', () => {
    const markup = render([entry()])

    expect(markup).toContain('Pricing')
    expect(markup).toContain('https://example.com/pricing')
    expect(markup).toContain('c9_meta_desc')
    expect(markup).toContain('Do you offer annual billing?')
  })

  it.each(LANGS)('distinguishes "none recorded" from "none declared" (%s)', lang => {
    const copy = copyFor(lang).assets
    const markup = render([entry({ findings: [], questions: [], converges: false })], lang)

    expect(markup).toContain(copy.findingsEmpty)
    expect(markup).toContain(copy.questionsEmpty)
  })

  it.each(LANGS)('offers registration when nothing is registered yet (%s)', lang => {
    const copy = copyFor(lang).assets
    const markup = render([], lang)

    expect(markup).toContain(copy.empty)
    expect(markup).toContain(copy.addTitle)
  })

  it.each(LANGS)('gives every control a touch-sized target (%s)', lang => {
    const markup = render([entry()], lang)
    const controls = markup.match(/<(button|input|select|a)\b[^>]*>/g) ?? []
    const tooSmall = controls.filter(control => !/min-h-11|h-11/.test(control))

    expect(tooSmall, `controls without a touch-sized height:\n${tooSmall.join('\n')}`).toEqual([])
  })

  it('renders different copy per language', () => {
    // A silent English fallback would pass every per-language assertion above.
    expect(render([entry()], 'en')).not.toBe(render([entry()], 'zh-HK'))
    expect(render([entry()], 'zh-HK')).not.toContain(en.assets.findingsScope)
  })
})
