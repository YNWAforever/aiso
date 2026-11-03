import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import type { StudioOverview } from '@/lib/conversation-studio/overview'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/dashboard/StudioSession', () => ({ useStudioSession: () => ({ setActiveId: vi.fn(), setNewDraft: vi.fn(), setNewTemplate: vi.fn() }) }))
const { StudioOverviewView, StudioWeeklyView } = await import('@/components/dashboard/StudioOverviewViews')

const clientId = '11111111-1111-4111-8111-111111111111'
const render = (lang: 'en' | 'zh-HK', node: React.ReactNode) => renderToString(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>)
const nothing: StudioOverview = { visibility: { status: 'empty' }, weeks: { status: 'empty' }, scan: { status: 'unavailable' }, searchConsole: { status: 'not_entitled' }, opportunities: { status: 'unavailable' } }

describe.each(['en', 'zh-HK'] as const)('Studio overview in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio.overview
  it('never shows a number for a section it could not read, and names each state honestly', () => {
    const html = render(lang, <StudioOverviewView clientId={clientId} brandName="Example" overview={nothing} />)
    expect(html).toContain(copy.empty)
    expect(html).toContain(copy.unavailable)
    expect(html).toContain(copy.notEntitled)
    expect(html).not.toMatch(/as-metric/)
    expect(html).not.toMatch(/\b0%/)
  })

  it('shows saved numbers with their scope, and links an unbound Search Console to Connections', () => {
    const html = render(lang, <StudioOverviewView clientId={clientId} brandName="Example" overview={{
      ...nothing,
      visibility: { status: 'ok', data: { sovScore: 37.5, brandMentions: 15, totalQueries: 40, platformCount: 3, week: '2026-10-26' } },
      scan: { status: 'ok', data: { state: 'limited', score: 61, grade: 'C', recordedAt: '2026-10-30T08:00:00.000Z' } },
      searchConsole: { status: 'unbound' },
    }} />)
    expect(html).toContain('37.5%')
    expect(html).toContain('2026-10-26')
    expect(html).toContain('61 · C')
    expect(html).toContain(copy.scanState.limited)
    expect(html).toContain(`/${lang}/dashboard/${clientId}/studio/connections`)
  })

  it('renders weekly rows and the existing client reports link', () => {
    const weekly = (lang === 'en' ? en : zh).conversationStudio.weekly
    const html = render(lang, <StudioWeeklyView clientId={clientId} weeks={{ status: 'ok', data: [{ week: '2026-10-26', sovScore: 37.5, brandMentions: 15, totalQueries: 40 }] }} />)
    expect(html).toContain('2026-10-26')
    expect(html).toContain(`/${lang}/dashboard/${clientId}/reports`)
    expect(html).toContain(weekly.title)
    expect(render(lang, <StudioWeeklyView clientId={clientId} weeks={{ status: 'unavailable' }} />)).toContain(copy.unavailable)
  })
})
