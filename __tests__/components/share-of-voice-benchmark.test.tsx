import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ShareOfVoiceBenchmark } from '@/components/pulse/ShareOfVoiceBenchmark'
import { buildShareOfVoice, type SovAnswer } from '@/lib/pulse/share-of-voice'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

const answer = (overrides: Partial<SovAnswer>): SovAnswer => ({
  scan_week: '2026-10-05', platform: 'gpt-4o', prompt_id: 'p1', question: 'Best bank in Hong Kong?',
  brand_mentioned: false, competitors_mentioned: [], ...overrides,
})
const view = buildShareOfVoice({
  brandName: 'Fimmick Bank',
  refs: [{ name: 'HSBC Holdings', aliases: ['HSBC'] }],
  answers: [
    answer({ brand_mentioned: true, competitors_mentioned: ['HSBC'] }),
    answer({ platform: 'gemini-flash', competitors_mentioned: ['Citi'] }),
    answer({ scan_week: '2026-09-28', competitors_mentioned: ['HSBC Holdings'] }),
  ],
})

const render = (props: Partial<Parameters<typeof ShareOfVoiceBenchmark>[0]> = {}) => renderToStaticMarkup(
  <ShareOfVoiceBenchmark state="ok" view={view} copy={en.shareOfVoice} lang="en" clientId="client-1" {...props} />,
)

describe('ShareOfVoiceBenchmark', () => {
  it('renders an accessible table for the latest week with the brand marked as you', () => {
    const html = render()
    expect(html).toContain('<caption')
    expect(html).toContain('Week of 2026-10-05')
    expect(html).toMatch(/<th scope="row"[^>]*>Fimmick Bank \(you\)/)
    expect(html).toContain('50%')               // brand: 1 of 2
    expect(html).toContain('1 of 2')
    expect(html).toContain('+50 pts')           // brand: 0% then 50%
    expect(html).toContain('−50 pts')           // HSBC: 100% then 50%
  })

  it('flags a named brand that is not on the competitor list', () => {
    expect(render()).toMatch(/Citi<span[^>]*>Not on your list/)
  })

  it('breaks the latest week down by platform and by question', () => {
    const html = render()
    expect(html).toContain('By platform')
    expect(html).toMatch(/<th scope="col"[^>]*>gemini-flash/)
    expect(html).toContain('By question')
    expect(html).toContain('Best bank in Hong Kong?')
    expect(html).toContain('Citi (1), HSBC Holdings (1)')
  })

  it('offers the CSV download and the competitor editor', () => {
    const html = render()
    expect(html).toContain('href="/api/dashboard/clients/client-1/share-of-voice?format=csv"')
    expect(html).toContain('download=""')
    expect(html).toContain('href="/en/dashboard/client-1/competitors"')
  })

  it('renders in Traditional Chinese', () => {
    const html = render({ copy: zhHK.shareOfVoice, lang: 'zh-HK' })
    expect(html).toContain('與競爭對手的聲量佔比')
    expect(html).toContain('Fimmick Bank（您）')
    expect(html).toContain('2 個回答中 1 個')
    expect(html).toContain('href="/zh-HK/dashboard/client-1/competitors"')
  })

  it('explains an empty history instead of showing zeroes, and offers no empty download', () => {
    const empty = buildShareOfVoice({ brandName: 'Fimmick Bank', refs: [], answers: [] })
    const html = render({ view: empty })
    expect(html).toContain(en.shareOfVoice.empty)
    expect(html).not.toContain('<table')
    expect(html).not.toContain('format=csv')
  })

  it('shows its own error without tables', () => {
    const html = render({ state: 'error', view: null })
    expect(html).toContain('role="alert"')
    expect(html).toContain(en.shareOfVoice.error)
    expect(html).not.toContain('<table')
  })
})
