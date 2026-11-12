import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceHome } from '@/lib/view-models/workspace-home'

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('@/components/ui/illustration', () => ({ Illustration: () => <div data-testid="illustration" /> }))
vi.mock('@/components/dashboard/today/TodayAsk', () => ({ TodayAsk: () => <form data-testid="today-ask" /> }))
vi.mock('@/components/reports/MonthlyReportEntry', () => ({ MonthlyReportEntry: () => <div data-testid="monthly-entry" /> }))
vi.mock('@/components/dashboard/overview/OverviewStats', () => ({ OverviewStats: () => <div data-testid="overview-stats" /> }))
vi.mock('@/components/dashboard/overview/ScoreTrend', () => ({ ScoreTrend: () => <div data-testid="score-trend" /> }))
vi.mock('@/components/PillarScoreCards', () => ({ PillarScoreCards: () => <div data-testid="pillars" /> }))
vi.mock('@/components/pulse/RunProgress', () => ({ RunProgress: () => <div data-testid="run-progress" /> }))

import { BrandToday } from '@/components/dashboard/today/BrandToday'

function home(overrides: Partial<WorkspaceHome> = {}): WorkspaceHome {
  return {
    client: { id: 'c1', brand_name: 'Example Brand', domain: 'example.com' },
    priorities: { state: 'ready', priorities: [], primaryAction: null, needsEvidence: [], observedFindings: 0 },
    siteHealth: { state: 'ready', observedAt: '2026-11-01T00:00:00Z', freshness: 'unknown', data: { scanId: 's1', domain: 'example.com', score: 66, grade: 'C', pillarScores: null } },
    history: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    visibility: { state: 'ready', observedAt: '2026-11-02T00:00:00Z', freshness: 'unknown', data: { sovScore: 32.44, brandMentions: 3, totalQueries: 10, platformCount: 2 } as NonNullable<WorkspaceHome['visibility']['data']> },
    recommendations: { state: 'empty', data: null, observedAt: null, freshness: 'unknown', generated: true },
    nextStep: { href: '/en/dashboard/c1?step=scan', labelKey: 'scan' },
    ...overrides,
  } as WorkspaceHome
}

const render = async (props: Parameters<typeof BrandToday>[0]) => renderToStaticMarkup(await BrandToday(props))

describe('BrandToday', () => {
  it('shows one primary action, the ask composer and exactly three numbers', async () => {
    const html = await render({ workspace: home(), lang: 'en', chatEnabled: true, clientReportsOnline: true })
    expect(html).toContain('Example Brand')
    expect(html).toContain('actionCaption')
    // The recommended action is a link; its caption/cta come from the workspace copy.
    expect(html).toContain('href="/en/dashboard/c1?step=scan"')
    expect(html).toContain('data-testid="today-ask"')
    // Exactly three metric links, all inside the metrics section.
    const start = html.indexOf('aria-label="eyebrow"')
    const metrics = html.slice(start, html.indexOf('</section>', start))
    expect((metrics.match(/<a /g) ?? []).length).toBe(3)
    // Everything else is disclosed, not competing.
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('detailsIntro')
  })

  it('hides the composer when Chat is not enabled and marks the account home', async () => {
    const html = await render({ workspace: home(), lang: 'en', chatEnabled: false, clientReportsOnline: true, accountHome: true })
    expect(html).not.toContain('today-ask')
    expect(html).toContain('oneBrandEyebrow')
  })

  it('is wired into the brand page only behind the SME flag, before WorkspaceHome', () => {
    const page = readFileSync(join(process.cwd(), 'app/[lang]/dashboard/[clientId]/page.tsx'), 'utf8')
    expect(page).toContain('isSmeCopilotUiEnabled()')
    expect(page.indexOf('<BrandToday')).toBeGreaterThan(-1)
    expect(page.indexOf('<BrandToday')).toBeLessThan(page.indexOf('<WorkspaceHome'))
    expect(page).toContain('!smeCopilot && STUDIO_DEFAULT_HOME')
  })
})
