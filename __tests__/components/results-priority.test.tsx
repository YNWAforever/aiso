import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import type { Scan } from '@/lib/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { ResultPriorityCard } from '@/components/dashboard/ResultPriorityCard'
import { firstScanOpportunity } from '@/lib/opportunities/scan-selection'
import { manyCandidates, clientId } from './c9c-fixtures'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

for (const lang of ['en', 'zh-HK']) {
  it(`places the first action before the lengthy scan diagnostic in ${lang}`, () => {
    const scan = { id: '22222222-2222-4222-8222-222222222222', score: 10, domain: 'example.test',
      created_at: '2026-10-17T00:00:00Z', results: {} } as Scan
    const html = renderToStaticMarkup(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <ResultsStep scan={scan} lang={lang} clientId="11111111-1111-4111-8111-111111111111"
        {...{ priority: <section data-testid="first-result-action">Selected evidence and draft action</section> }} />
    </NextIntlClientProvider>)
    expect(html).toContain('data-testid="first-result-action"')
    expect(html.indexOf('data-testid="first-result-action"')).toBeLessThan(html.indexOf(`aria-label="${(lang === 'en' ? en : zh).resultSummary.title}"`))
  })
  it(`shows source-bound create, existing and unavailable states without provider claims in ${lang}`, () => {
    const render = (initial: ReturnType<typeof firstScanOpportunity>) => renderToStaticMarkup(
      <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
        <ResultPriorityCard clientId={clientId} scanId={manyCandidates.window.scanId!} brandName="Synthetic brand" initial={initial} />
      </NextIntlClientProvider>)
    const copy = (lang === 'en' ? en : zh).resultSummary
    const selected = firstScanOpportunity(manyCandidates, manyCandidates.window.scanId!)
    const html = render(selected)
    expect(html).toContain(copy.createDraft)
    expect(html).toContain(copy.priorityDraftNotice)
    expect(html).toContain('https://example.test')
    expect(html).not.toContain('?secret=1')
    expect(html).not.toContain('>0<')
    const id = '44444444-4444-4444-8444-444444444444'
    const saved = render({ ...selected, suggestion: { ...selected.suggestion!, savedDraftId: id } })
    expect(saved).toContain(copy.openDraft)
    expect(saved).toContain(`scanId=${manyCandidates.window.scanId}&amp;draft=${id}`)
    expect(saved).not.toContain(`>${copy.createDraft}<`)
    expect(render({ suggestion: null, unavailable: true })).toContain(copy.priorityUnavailable)
    expect(render({ suggestion: null, unavailable: false })).toContain(copy.priorityEmpty)
    const foreign = renderToStaticMarkup(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <ResultPriorityCard clientId={clientId} scanId="99999999-9999-4999-8999-999999999999" initial={selected} />
    </NextIntlClientProvider>)
    expect(foreign).not.toContain(`>${copy.createDraft}<`)
    expect(foreign).not.toContain('https://example.test')
  })
}
