import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PortfolioView } from '@/components/dashboard/PortfolioView'
import type { Portfolio } from '@/lib/view-models/portfolio'
import type { ActivationProgress } from '@/lib/view-models/activation-progress'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/**
 * The dashboard root for an owner who has just arrived.
 *
 * Two gaps meet on this screen. `/[lang]/onboarding` has no inbound link
 * anywhere in the product, so `/api/onboarding/complete` — the only path that
 * claims the visitor's anonymous scan, starts the trial and seeds the question
 * bank — cannot be reached by using the product. And `readActivation` has never
 * had a caller, so the derived funnel was computed for nobody.
 *
 * `AddBrandWizard` is not the same path and does not close the first: it posts
 * to `/api/dashboard/clients`, which adds a brand without claiming a scan or
 * starting a trial.
 */

const LANGS = ['en', 'zh-HK'] as const
const copyFor = (lang: (typeof LANGS)[number]) => (lang === 'zh-HK' ? zhHK : en)

const portfolio = (clientCount: number): Portfolio => ({
  clients: Array.from({ length: clientCount }, (_, index) => ({
    id: `client-${index}`,
    brand_name: `Brand ${index}`,
    domain: 'example.com',
    visibility: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
  })) as Portfolio['clients'],
  history: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
  capacity: { state: 'known', count: clientCount, limit: 3, canCreate: true, plan: 'free' },
})

const ready = (overrides: Partial<Extract<ActivationProgress, { state: 'ready' }>> = {}) => ({
  state: 'ready' as const,
  reached: 1,
  total: 6,
  furthest: 'first_scan' as const,
  next: 'first_workspace' as const,
  milestones: [
    { key: 'first_scan' as const, reachedAt: '2026-09-01T00:00:00.000Z', counted: true },
    { key: 'first_workspace' as const, reachedAt: null, counted: false },
    { key: 'first_source' as const, reachedAt: null, counted: false },
    { key: 'first_approved_work' as const, reachedAt: null, counted: false },
    { key: 'first_export' as const, reachedAt: null, counted: false },
    { key: 'first_declared_delivery' as const, reachedAt: null, counted: false },
  ],
  outOfOrder: [],
  ...overrides,
})

function render(options: {
  lang?: (typeof LANGS)[number]
  clients?: number
  activation?: ActivationProgress
  firstRunScanId?: string | null
} = {}) {
  return renderToStaticMarkup(
    <PortfolioView
      portfolio={portfolio(options.clients ?? 0)}
      lang={options.lang ?? 'en'}
      creationControl={null}
      activation={options.activation ?? ready()}
      firstRunScanId={options.firstRunScanId ?? null}
    />,
  )
}

describe('the first-run path out of an empty portfolio', () => {
  it.each(LANGS)('offers onboarding when the owner has no brands (%s)', lang => {
    const markup = render({ lang, clients: 0 })

    expect(markup).toContain(`/${lang}/onboarding`)
    expect(markup).toContain(copyFor(lang).portfolio.firstRunAction)
  })

  it('carries the scan the visitor already ran, so onboarding can claim it', () => {
    const markup = render({ clients: 0, firstRunScanId: 'scan-abc' })

    expect(markup).toContain('/en/onboarding?scan=scan-abc')
  })

  it('links to onboarding without a scan when there is no pending claim', () => {
    const markup = render({ clients: 0, firstRunScanId: null })

    expect(markup).toContain('href="/en/onboarding"')
    expect(markup).not.toContain('?scan=')
  })

  it('does not push onboarding at an owner who already has a brand', () => {
    // Onboarding starts a trial and seeds a question bank. Offering it to an
    // established account invites a second first-run.
    const markup = render({ clients: 2 })

    expect(markup).not.toContain('/en/onboarding')
  })

  it('gives the call to action a touch-sized target', () => {
    // Review happens on a phone; every interactive element on this screen is
    // held to the same 44px minimum as the rest of the dashboard.
    const markup = render({ clients: 0 })
    const anchor = markup.match(/<a [^>]*onboarding[^>]*>/)?.[0] ?? ''

    expect(anchor).toContain('min-h-11')
  })

  it.each(LANGS)('says something different in each language (%s)', lang => {
    const markup = render({ lang, clients: 0 })
    const other = copyFor(lang === 'en' ? 'zh-HK' : 'en')

    // A missing translation falling back to English would pass a "contains the
    // key's value" assertion in both locales. This is what catches it.
    expect(markup).not.toContain(other.portfolio.firstRunAction)
  })
})

describe('activation progress on the dashboard root', () => {
  it.each(LANGS)('reports the consecutive count and the next step (%s)', lang => {
    const copy = copyFor(lang).activation
    const markup = render({ lang, activation: ready() })

    expect(markup).toContain(copy.title)
    expect(markup).toContain(copy.milestones.first_workspace)
    expect(markup).toContain('1')
    expect(markup).toContain('6')
  })

  it('names a milestone reached out of order instead of counting it', () => {
    const copy = en.activation
    const markup = render({
      activation: ready({
        reached: 2,
        furthest: 'first_workspace',
        next: 'first_source',
        outOfOrder: ['first_export'],
      }),
    })

    expect(markup).toContain(copy.outOfOrder)
    expect(markup).toContain(copy.milestones.first_export)
  })

  it('says the read failed rather than showing a zero', () => {
    // The distinction lib/telemetry/activation.ts throws to preserve: an
    // incident must not render as an account that has done nothing.
    const markup = render({ activation: { state: 'unavailable' } })

    expect(markup).toContain(en.activation.unavailable)
    expect(markup).not.toContain(en.activation.progress)
  })

  it.each(LANGS)('translates the milestone labels (%s)', lang => {
    const markup = render({ lang })
    const other = copyFor(lang === 'en' ? 'zh-HK' : 'en').activation

    expect(markup).not.toContain(other.milestones.first_workspace)
  })
})
