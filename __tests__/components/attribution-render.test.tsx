import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { NextIntlClientProvider, createTranslator } from 'next-intl'
import {
  FigureTable,
  REASON_COPY,
  STATUS_COPY,
  TargetRow,
  TargetStatusNotice,
  type FigureRow,
} from '@/components/attribution/MeasuredChangeBlock'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
import { TARGET_STATUSES, parseAttributionResponse, type AttributionTargetView } from '@/lib/attribution/dto'
import type { Figure } from '@/lib/attribution/types'
import { fixtureProps } from './c9e-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('server-only', () => ({}))

const LANGS = ['en', 'zh-HK'] as const
type Lang = (typeof LANGS)[number]
const messages = (lang: Lang) => (lang === 'en' ? en : zh)
const tFor = (lang: Lang) =>
  createTranslator({ locale: lang, messages: messages(lang), namespace: 'attribution' }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>)

const CAPTION =
  'Observed change in the 28 days after delivery compared with the 28 days before. Other changes and seasonality also affect these figures.'

const fig = (before: number | null, after: number | null, changePct: Figure['changePct'] = null): Figure => ({
  before,
  after,
  change: before === null || after === null ? null : after - before,
  changePct,
})

const comparablePage = (over: Partial<AttributionTargetView> = {}): AttributionTargetView => ({
  scope: 'page',
  asset: { id: 'a1', url: 'https://example.com/pricing', label: 'Pricing' },
  status: 'comparable',
  search: {
    clicks: fig(10, 15, 0.5),
    impressions: fig(200, 300, 0.5),
    ctr: fig(0.05, 0.05, null),
    position: fig(8, 6.5, null),
  },
  ...over,
})

describe('catalogue', () => {
  it('has the same attribution keys in both languages', () => {
    expect(Object.keys(en.attribution).sort()).toEqual(Object.keys(zh.attribution).sort())
  })

  it.each(LANGS)('has copy for every status and every reason in %s', lang => {
    const copy = messages(lang).attribution as Record<string, string>
    const statuses = TARGET_STATUSES.filter(s => s !== 'comparable')
    expect(Object.keys(STATUS_COPY).sort()).toEqual([...statuses].sort())
    for (const key of [...Object.values(STATUS_COPY), ...Object.values(REASON_COPY)]) {
      expect(copy[key]?.trim().length, key).toBeGreaterThan(0)
    }
    expect(Object.keys(REASON_COPY).sort()).toEqual(['not_bound', 'not_enabled', 'rebound', 'sync_failing'])
  })

  it('gives every status and reason its own sentence', () => {
    const copy = en.attribution as Record<string, string>
    const keys = [...Object.values(STATUS_COPY), ...Object.values(REASON_COPY)]
    expect(new Set(keys.map(k => copy[k])).size).toBe(keys.length)
  })

  it('writes the Traditional Chinese copy in Chinese', () => {
    const copy = zh.attribution as Record<string, string>
    for (const key of [...Object.values(STATUS_COPY), ...Object.values(REASON_COPY), 'measuredCaption', 'measuredTitle']) {
      expect(copy[key], key).toMatch(/\p{Script=Han}/u)
    }
  })

  it('holds the standing caption exactly', () => {
    expect(en.attribution.measuredCaption).toBe(CAPTION)
  })

  it('never claims causation anywhere in the measured-change copy', () => {
    for (const lang of LANGS) {
      const copy = messages(lang).attribution as Record<string, string>
      for (const [key, value] of Object.entries(copy)) {
        if (key === 'measureHelp') continue // the delivery form's own sentence, not this block's
        expect(value, key).not.toMatch(/caused|result of|導致|造成|因為/i)
      }
    }
  })
})

describe('TargetStatusNotice', () => {
  const notice = (lang: Lang, props: Record<string, unknown>) =>
    html(<TargetStatusNotice t={tFor(lang)} source="search" {...(props as { status: 'withdrawn' })} />)

  it.each(LANGS)('shows each status with its own copy in %s', lang => {
    const copy = messages(lang).attribution as Record<string, string>
    expect(notice(lang, { status: 'withdrawn' })).toContain(copy.statusWithdrawn)
    expect(notice(lang, { status: 'not_supported' })).toContain(copy.statusNotSupported)
    expect(notice(lang, { status: 'not_measured' })).toContain(copy.statusNotMeasured)
  })

  it('tells the owner to re-record to measure, and names the date a pending one is ready', () => {
    expect(notice('en', { status: 'not_measured' })).toContain('Re-record the delivery to measure it')
    const pending = notice('en', { status: 'not_ready', readyOn: '2026-11-04' })
    expect(pending).toContain('2026-11-04')
    expect(notice('zh-HK', { status: 'not_ready', readyOn: '2026-11-04' })).toContain('2026-11-04')
  })

  it('names the missing range of an insufficient history', () => {
    const out = notice('en', { status: 'insufficient_history', missingFrom: '2026-09-01', missingTo: '2026-09-14' })
    expect(out).toContain('2026-09-01')
    expect(out).toContain('2026-09-14')
  })

  it.each(LANGS)('gives each unavailable reason its own sentence in %s', lang => {
    const out = ['not_bound', 'rebound', 'sync_failing'].map(reason => notice(lang, { status: 'unavailable', reason }))
    expect(new Set(out).size).toBe(3)
    const copy = messages(lang).attribution as Record<string, string>
    expect(out[0]).toContain(copy.reasonNotBound.replace('{source}', copy.sourceSearch))
    expect(notice(lang, { status: 'unavailable', reason: 'not_enabled', source: 'enquiries' })).toContain(copy.reasonNotEnabled)
  })

  it('names the source it is talking about', () => {
    expect(notice('en', { status: 'unavailable', reason: 'not_bound', source: 'enquiries' })).toContain('Google Analytics')
    expect(notice('en', { status: 'unavailable', reason: 'not_bound', source: 'search' })).toContain('Search Console')
  })

  it('falls back to a generic sentence for a reason it does not know', () => {
    expect(notice('en', { status: 'unavailable', reason: 'brand_new' })).toContain(en.attribution.statusUnavailable)
    expect(notice('en', { status: 'unavailable' })).toContain(en.attribution.statusUnavailable)
  })

  it('renders nothing for a comparable verdict', () => {
    expect(notice('en', { status: 'comparable' })).toBe('')
  })
})

describe('FigureTable', () => {
  const table = (lang: Lang, r: FigureRow[]) => html(<FigureTable title="T" rows={r} t={tFor(lang)} locale={lang} />)

  it('shows before, after and change for counts, with the percentage', () => {
    const out = table('en', [{ key: 'clicks', label: 'Clicks', kind: 'count', figure: fig(1200, 1500, 0.25) }])
    expect(out).toContain('1,200')
    expect(out).toContain('1,500')
    expect(out).toContain('+300')
    expect(out).toContain('+25%')
  })

  it('renders a new figure as the "new" copy and never as Infinity', () => {
    for (const lang of LANGS) {
      const out = table(lang, [{ key: 'clicks', label: 'Clicks', kind: 'count', figure: fig(0, 40, 'new') }])
      expect(out).toContain(messages(lang).attribution.changeNew)
      expect(out).not.toMatch(/Infinity|NaN|∞/)
    }
  })

  it('renders an absent percentage as a dash, not as undefined or null', () => {
    const out = table('en', [{ key: 'clicks', label: 'Clicks', kind: 'count', figure: fig(null, null, null) }])
    expect(out).not.toMatch(/undefined|null|NaN/)
    expect(out).toContain('–')
  })

  it('shows CTR as a percentage and its change in percentage points, rounded only here', () => {
    const out = table('en', [{ key: 'ctr', label: 'CTR', kind: 'ctr', figure: { before: 0.1, after: 0.12, change: 0.019999999999999997, changePct: null } }])
    expect(out).toContain('10%')
    expect(out).toContain('12%')
    expect(out).toContain('+2 percentage points')
    expect(out).not.toMatch(/0\.0199|19999|0\.1999/)
  })

  it('renders a float-noise CTR cleanly', () => {
    const out = table('en', [{ key: 'ctr', label: 'CTR', kind: 'ctr', figure: { before: 0.19999999999999998, after: 0.2, change: 2.7755575615628914e-17, changePct: null } }])
    expect(out).toContain('20%')
    expect(out).not.toMatch(/99999|e-17/)
    expect(out).not.toContain('+0 percentage')
    expect(out).not.toMatch(/>[-−]0/)
    expect(out).toContain('>0 percentage points<')
  })

  it('shows position with one decimal and its change in places, neutral about direction', () => {
    const out = table('en', [{ key: 'position', label: 'Position', kind: 'position', figure: fig(8, 6.5, null) }])
    expect(out).toContain('8.0')
    expect(out).toContain('6.5')
    expect(out).toContain('-1.5 places')
    expect(out).not.toMatch(/improv|worse|better|declin/i)
  })

  it('has real column headers and row headers', () => {
    const out = table('en', [{ key: 'clicks', label: 'Clicks', kind: 'count', figure: fig(1, 2, 1) }])
    expect(out).toContain('scope="col"')
    expect(out).toContain('scope="row"')
    expect(out).toContain(en.attribution.colBefore)
    expect(out).toContain(en.attribution.colAfter)
    expect(out).toContain(en.attribution.colChange)
  })
})

describe('TargetRow', () => {
  const row = (lang: Lang, target: AttributionTargetView) => html(<TargetRow target={target} t={tFor(lang)} locale={lang} />)

  it.each(LANGS)('shows a comparable page with all four metrics, before, after and change in %s', lang => {
    const out = row(lang, comparablePage())
    const copy = messages(lang).attribution
    for (const label of [copy.metricClicks, copy.metricImpressions, copy.metricCtr, copy.metricPosition]) expect(out).toContain(label)
    expect(out).toContain('Pricing')
    expect(out).toContain('https://example.com/pricing')
    expect(out).toContain('+5')
    expect(out).toContain('300')
    expect(out).toContain('5%')
    expect(out).toContain('8.0')
    expect(out).toContain('6.5')
  })

  it('shows the standing caption exactly on a comparable row, in English', () => {
    expect(row('en', comparablePage())).toContain(CAPTION)
  })

  it('shows the Traditional Chinese caption on a comparable row', () => {
    expect(row('zh-HK', comparablePage())).toContain(zh.attribution.measuredCaption)
  })

  it('shows the caption on a comparable whole-site row', () => {
    const out = row('en', { scope: 'site', status: 'comparable', search: comparablePage().search })
    expect(out).toContain(CAPTION)
    expect(out).toContain(en.attribution.scopeSite)
  })

  it('shows no caption and no figures on a row that compares nothing', () => {
    for (const status of ['withdrawn', 'not_supported', 'not_measured', 'not_ready', 'insufficient_history', 'unavailable'] as const) {
      const out = row('en', { scope: 'page', asset: comparablePage().asset, status, readyOn: '2026-11-04', reason: 'not_bound' })
      expect(out, status).not.toContain(CAPTION)
      expect(out, status).not.toContain('<table')
    }
  })

  it('renders a scope-less row (nothing measured) as just its notice', () => {
    const out = row('en', { scope: null, status: 'not_measured' })
    expect(out).toContain(en.attribution.statusNotMeasured)
    expect(out).not.toContain(en.attribution.scopePage)
    expect(out).not.toContain(en.attribution.scopeSite)
  })

  it('shows enquiries by source on a whole-site row', () => {
    const out = row('en', {
      scope: 'site',
      status: 'comparable',
      search: comparablePage().search,
      enquiries: {
        status: 'comparable',
        total: fig(10, 14, 0.4),
        organic_search: fig(6, 8, 0.3333333333333333),
        ai_assistant: fig(0, 3, 'new'),
        other: fig(4, 3, -0.25),
      },
    })
    for (const label of [en.attribution.enquiriesTitle, en.attribution.enquiriesTotal, en.attribution.enquiriesOrganic, en.attribution.enquiriesAi, en.attribution.enquiriesOther]) {
      expect(out).toContain(label)
    }
    expect(out).toContain('+40%')
    expect(out).toContain('+33.3%')
    expect(out).toContain('-25%')
    expect(out).toContain(en.attribution.changeNew)
    expect(out).not.toMatch(/Infinity|NaN|undefined/)
  })

  it('keeps the search figures when only the enquiries are unavailable', () => {
    const out = row('en', {
      scope: 'site',
      status: 'comparable',
      search: comparablePage().search,
      enquiries: { status: 'unavailable', reason: 'not_enabled' },
    })
    expect(out).toContain(en.attribution.metricClicks)
    expect(out).toContain(en.attribution.reasonNotEnabled)
  })

  it('shows the caption when only the enquiries are comparable (search not ready yet)', () => {
    const out = row('en', {
      scope: 'site',
      status: 'not_ready',
      readyOn: '2026-11-04',
      enquiries: { status: 'comparable', total: fig(1, 2, 1), organic_search: fig(1, 2, 1), ai_assistant: fig(0, 0, 0), other: fig(0, 0, 0) },
    })
    expect(out).toContain('2026-11-04')
    expect(out).toContain(CAPTION)
  })

  it('never renders a causal word, in either language', () => {
    for (const lang of LANGS) expect(row(lang, comparablePage())).not.toMatch(/caused|result of/i)
  })
})

describe('parseAttributionResponse', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    deliveredOn: '2026-10-01',
    windows: { before: { from: '2026-09-03', to: '2026-09-30' }, after: { from: '2026-10-02', to: '2026-10-29' } },
    readyOn: '2026-11-01',
    targets: [{ scope: 'page', asset: { id: 'a', url: 'https://x.test/', label: 'X' }, status: 'not_ready', readyOn: '2026-11-01' }],
    ...over,
  })
  const search = (clicks: unknown) => ({ clicks, impressions: fig(1, 1, 0), ctr: fig(1, 1, null), position: fig(1, 1, null) })

  it('reads the route’s body', () => {
    const view = parseAttributionResponse(body())
    expect(view.deliveredOn).toBe('2026-10-01')
    expect(view.targets[0]).toMatchObject({ scope: 'page', status: 'not_ready', readyOn: '2026-11-01' })
  })

  it('reads a never-delivered version, a withdrawn one and a scope-less row', () => {
    expect(parseAttributionResponse({ deliveredOn: null, windows: null, readyOn: null, targets: [] }).targets).toEqual([])
    const withdrawn = parseAttributionResponse({
      deliveredOn: null, windows: null, readyOn: null,
      targets: [{ scope: 'site', status: 'withdrawn' }, { scope: null, status: 'not_measured' }],
    })
    expect(withdrawn.targets.map(t => t.status)).toEqual(['withdrawn', 'not_measured'])
  })

  it('keeps figures and the new/zero percentages as they came', () => {
    const view = parseAttributionResponse(body({
      targets: [{
        scope: 'site',
        status: 'comparable',
        search: search(fig(0, 3, 'new')),
        enquiries: { status: 'comparable', total: fig(1, 1, 0), organic_search: fig(1, 1, 0), ai_assistant: fig(0, 0, 0), other: fig(0, 0, 0) },
      }],
    }))
    expect(view.targets[0].search?.clicks.changePct).toBe('new')
    expect(view.targets[0].enquiries?.total?.changePct).toBe(0)
  })

  it.each([
    ['a non-object', 'nope'],
    ['no targets', { deliveredOn: null, windows: null, readyOn: null }],
    ['an unknown status', body({ targets: [{ scope: 'page', status: 'shiny' }] })],
    ['an unknown scope', body({ targets: [{ scope: 'galaxy', status: 'withdrawn' }] })],
    ['a figure that is a string', body({ targets: [{ scope: 'site', status: 'comparable', search: search({ before: '1', after: 2, change: 1, changePct: 1 }) }] })],
    ['a percentage that is a stray string', body({ targets: [{ scope: 'site', status: 'comparable', search: search({ before: 0, after: 2, change: 2, changePct: 'Infinity' }) }] })],
  ])('rejects %s', (_name, value) => {
    expect(() => parseAttributionResponse(value)).toThrow()
  })
})

describe('VersionWorkspace', () => {
  const render = (node: React.ReactNode, lang: Lang) =>
    renderToString(<NextIntlClientProvider locale={lang} messages={messages(lang)} timeZone="UTC">{node}</NextIntlClientProvider>)
  const pages = { pages: [{ id: 'p1', url: 'https://example.com/a', label: 'A' }] }

  it.each(LANGS)('renders the measured-change block beside the technical outcomes when attribution is on, in %s', lang => {
    const out = render(<VersionWorkspace {...fixtureProps} measureOptions={pages} />, lang)
    expect(out).toContain(messages(lang).attribution.measuredTitle)
    expect(out).toContain(messages(lang).outcomes.title)
  })

  it('omits the block when attribution is off, leaving the outcomes', () => {
    const out = render(<VersionWorkspace {...fixtureProps} measureOptions={null} />, 'en')
    expect(out).not.toContain(en.attribution.measuredTitle)
    expect(out).toContain(en.outcomes.title)
  })
})
