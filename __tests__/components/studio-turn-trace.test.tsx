import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { StudioTurnTrace } from '@/components/dashboard/StudioTurnTrace'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const render = (lang: 'en' | 'zh-HK', props: Parameters<typeof StudioTurnTrace>[0]) => renderToString(
  <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC"><StudioTurnTrace {...props} /></NextIntlClientProvider>,
)

describe.each(['en', 'zh-HK'] as const)('StudioTurnTrace in %s', lang => {
  const studio = (lang === 'en' ? en : zh).conversationStudio
  it('is collapsed, counts the reads, and names each with its own source title', () => {
    const html = render(lang, { attached: { label: 'Spring menu' }, gsc: {}, dfs: { error: 'X' }, firecrawl: { pending: true } })
    expect(html).not.toMatch(/<details[^>]*open/)
    for (const title of [studio.savedDataLabel, studio.attach.badge, studio.gsc.title, studio.dfs.title, studio.firecrawl.title]) expect(html).toContain(title)
    expect(html).not.toContain(studio.live.title)
    expect(html).toContain(studio.trace.unavailable)
    expect(html).toContain('Spring menu')
    expect(html).toContain('data-status="pending"')
  })

  it('lists saved evidence alone for a turn that queried nothing else', () => {
    const html = render(lang, {})
    expect(html.match(/<li /g)?.length).toBe(1)
    expect(html).toContain(studio.savedDataLabel)
  })
})
