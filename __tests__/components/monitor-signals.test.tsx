import { describe, expect, it } from 'vitest'
import { MonitorSignals } from '@/components/pulse/MonitorSignals'
import { monitorView } from '../../tests/fixtures/monitor'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const now = new Date('2026-10-23T00:00:00Z')

describe('MonitorSignals', () => {
  it.each(['en', 'zh-HK'] as const)('says plainly that weekly tracking has stopped, with the last week, in %s', lang => {
    const copy = (lang === 'en' ? en : zh).pulseView.signals
    const html = renderWithIntl(<MonitorSignals view={monitorView('2026-09-28')} lang={lang} now={now} />, lang)
    expect(html).toContain(copy.status.stale.replace('{week}', '2026-09-28'))
    expect(html).toContain('ChatGPT')
    expect(html).toContain(copy.competitors.you.replace('{brand}', 'Example Brand'))
    expect(html).toContain(copy.competitors.share.replace('{n}', '50'))
    expect(html).toContain(copy.alerts.last.replace('{date}', '2026-09-29'))
  })
  it('describes fresh results by their week, never as a running schedule', () => {
    const html = renderWithIntl(<MonitorSignals view={monitorView('2026-10-19')} lang="en" now={now} />)
    expect(html).toContain(en.pulseView.signals.status.fresh.replace('{week}', '2026-10-19'))
    expect(html.toLowerCase()).not.toContain('running')
  })
  it('says there are no results yet, and shows no chart, when nothing was ever collected', () => {
    const html = renderWithIntl(<MonitorSignals view={monitorView(null)} lang="en" now={now} />)
    expect(html).toContain(en.pulseView.signals.status.never)
    expect(html).toContain(en.pulseView.signals.platforms.empty)
    expect(html).toContain(en.pulseView.signals.competitors.empty)
    expect(html).not.toContain('data-testid="platform-dots"')
  })
})
