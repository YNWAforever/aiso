import { afterAll, expect, it } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatDisplayDate } from '@/lib/format/date'
import { VisibilityView } from '@/components/pulse/VisibilityView'
import type { PulseView } from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

function fixture(state: 'ready' | 'empty' | 'error' | 'partial'): PulseView {
  const ready = state === 'ready' || state === 'partial'
  return {
    client: { id: 'client-1', brand_name: 'FOTOMAX' },
    observations: {
      state,
      coverage: state === 'partial'
        ? { expected: null, recorded: 40, collected: 40, classified: 31, mentioned: 21, collectionRate: null, classificationRate: 31 / 40, mentionRate: 21 / 31, provenance: 'legacy' }
        : ready
          ? { expected: 50, recorded: 49, collected: 49, classified: 49, mentioned: 34, collectionRate: 49 / 50, classificationRate: 1, mentionRate: 34 / 49, provenance: 'ledger' }
          : null,
      latestKpi: ready ? { sovScore: state === 'partial' ? 69.4 : 69.4, brandMentions: 34, totalQueries: 49, platformCount: 5, scanWeek: '2026-11-16' } : null,
      latestWeek: ready ? '2026-11-16' : null,
      series: ready
        ? [
            {
              platform: null,
              points: [
                { week: '2026-11-09', sov: 65.3, state: 'complete' },
                { week: '2026-11-16', sov: 69.4, state: state === 'partial' ? 'partial' : 'complete' },
              ],
            },
            {
              platform: 'ChatGPT',
              points: [
                { week: '2026-11-09', sov: 60, state: 'complete' },
                { week: '2026-11-16', sov: 80, state: 'complete' },
              ],
            },
          ]
        : [],
    },
    prompts: {
      state: ready ? 'ready' : 'empty',
      data: ready
        ? [{ id: 'p1', question: 'FOTOMAX 邊度有分店？', category: 'brand_query', language: 'zh-HK', is_active: true }]
        : [],
    },
    missed: {
      state: state === 'error' ? 'error' : ready ? 'ready' : 'empty',
      data: ready
        ? [{ platform: 'ChatGPT', question: 'FOTOMAX 邊度有分店？', competitors_mentioned: ['Instax'], scan_week: '2026-11-16' }]
        : [],
    },
  } as PulseView
}

const render = (state: 'ready' | 'empty' | 'error' | 'partial', lang: string) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <VisibilityView view={fixture(state)} lang={lang} now={new Date('2026-11-17T00:00:00Z')} />
    </NextIntlClientProvider>,
  )

it.each(['en', 'zh-HK'])('shows the measured mention rate, evidence date and scoped answers in %s', lang => {
  const copy = (lang === 'en' ? en : zh).pulseView.visibility
  const html = render('ready', lang).replace(/&#x27;|&#39;/g, "'")
  expect(html).toContain(copy.mentionRate)
  expect(html).toContain('69.4%')
  expect(html).toContain(copy.freshWeek.replace('{week}', formatDisplayDate('2026-11-16', lang)))
  expect(html).toContain('id="first-monitoring"')
  expect(html).toContain(copy.viewAnswers)
  expect(html).toContain('/observations?week=2026-11-16')
  expect(html).toContain(copy.missedTitle)
  // The freshness banner belongs to the legacy Monitor view; the hero owns it here.
  expect(html).not.toContain('data-testid="monitor-status"')
})

it.each(['en', 'zh-HK'])('never renders a fabricated zero for empty or failed reads in %s', lang => {
  const base = (lang === 'en' ? en : zh).pulseView
  expect(render('empty', lang)).not.toContain('0%')
  expect(render('empty', lang)).toContain(base.visibility.emptyTitle)
  expect(render('error', lang)).toContain(base.error)
  expect(render('error', lang)).not.toContain('0%')
})

it.each(['en', 'zh-HK'])('marks a partial sample and keeps the numbers in %s', lang => {
  const copy = (lang === 'en' ? en : zh).pulseView
  const html = render('partial', lang)
  expect(html).toContain(copy.partial)
  expect(html).toContain('69.4%')
  expect(html).toContain(copy.visibility.noComparison)
})

it('keeps the three supporting numbers in one compact row on phones', () => {
  const html = render('ready', 'en')
  expect(html).toContain('grid-cols-3')
  expect(html).toMatch(/gap-2 p-3 sm:gap-3 sm:p-5/)
  expect(html).toMatch(/text-2xl[^"]*sm:text-3xl/)
})

it('shows the missed question, platform and named competitor', () => {
  const html = render('ready', 'zh-HK')
  expect(html).toContain('FOTOMAX 邊度有分店？')
  expect(html).toContain('ChatGPT')
  expect(html).toContain('Instax')
})

afterAll(() => {
  const directory = process.env.WHAT_AI_SAYS_HTML_DIR
  if (!directory) return
  const cssPath = process.env.WHAT_AI_SAYS_CSS_PATH
  if (!cssPath) throw new Error('WHAT_AI_SAYS_CSS_PATH must identify the production CSS')
  const css = readFileSync(cssPath, 'utf8')
  mkdirSync(directory, { recursive: true })
  for (const lang of ['en', 'zh-HK']) {
    for (const state of ['ready', 'partial', 'empty', 'error'] as const) {
      const html = render(state, lang)
      writeFileSync(join(directory, `${lang}-${state}.html`),
        `<!doctype html><html lang="${lang}" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What AI says — visibility fixture</title><style>${css}</style></head><body>${html}</body></html>`)
    }
  }
})
