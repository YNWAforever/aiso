import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CompetitorsEditor } from '@/components/dashboard/CompetitorsEditor'
import type { CompetitorView } from '@/lib/competitors/client'

function messages(locale: 'en' | 'zh-HK') {
  return JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'))
}

const saved: CompetitorView = {
  id: 'comp-1', name: 'HSBC Holdings', aliases: ['HSBC', '匯豐'], domains: ['hsbc.com.hk'],
  created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
}
const legacy: CompetitorView = { id: null, name: 'Hang Seng Bank', aliases: [], domains: [], created_at: null, updated_at: null }

function render(competitors: CompetitorView[], locale: 'en' | 'zh-HK' = 'en', max = 10) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
      <CompetitorsEditor clientId="client-1" initialCompetitors={competitors} max={max} />
    </NextIntlClientProvider>,
  )
}

describe('CompetitorsEditor', () => {
  it('shows each competitor with its spellings and websites as editable text', () => {
    const html = render([saved])
    expect(html).toContain('value="HSBC Holdings"')
    expect(html).toContain('value="HSBC, 匯豐"')
    expect(html).toContain('value="hsbc.com.hk"')
    expect(html).toContain('1 of 10 competitors')
  })

  it('marks a name added during onboarding as not yet saved', () => {
    const html = render([legacy])
    expect(html).toContain('Hang Seng Bank')
    expect(html).toContain('Added during setup. Save to add other spellings or websites.')
    expect(render([saved])).not.toContain('Added during setup')
  })

  it('labels every input and names each action after its competitor', () => {
    const html = render([saved])
    const ids = [...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map(m => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(6)
    for (const id of ids) expect(html).toContain(`for="${id}"`)
    expect(html).toContain('aria-label="Save HSBC Holdings"')
    expect(html).toContain('aria-label="Remove HSBC Holdings"')
    expect(html).toMatch(/aria-describedby="[^"]+-aliases-hint"/)
  })

  it('renders in Traditional Chinese from the zh-HK catalogue', () => {
    const html = render([saved, legacy], 'zh-HK')
    expect(html).toContain('其他寫法')
    expect(html).toContain('2 / 10 個競爭對手')
    expect(html).toContain('aria-label="移除 HSBC Holdings"')
    expect(html).toContain('於設定時加入')
  })

  it('shows the empty state and keeps the add form usable', () => {
    const html = render([])
    expect(html).toContain('No competitors yet.')
    expect(html).toContain('Add competitor')
    expect(html).not.toMatch(/<fieldset[^>]*disabled/)
  })

  it('disables adding at the limit and says why', () => {
    const full = Array.from({ length: 2 }, (_, i) => ({ ...saved, id: `c${i}`, name: `Brand ${i}` }))
    const html = render(full, 'en', 2)
    expect(html).toMatch(/<fieldset[^>]*disabled[^>]*>(?:(?!<\/fieldset>).)*Add a competitor/s)
    expect(html).toContain('You can track up to 2 competitors.')
  })

  it('never renders a raw message key', () => {
    for (const locale of ['en', 'zh-HK'] as const) {
      expect(render([saved, legacy], locale)).not.toMatch(/competitors\.|err_|_label|_hint/)
    }
  })
})
