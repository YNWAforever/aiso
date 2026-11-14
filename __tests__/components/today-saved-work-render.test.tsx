import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentPropsWithoutRef } from 'react'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import type { WorkspaceHome } from '@/lib/view-models/workspace-home'
import type { TaskRow } from '@/lib/tasks/status'

const copy = vi.hoisted(() => ({ lang: 'en', links: [] as { href: string; prefetch: boolean | undefined }[] }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    const source = copy.lang === 'en' ? en : zh
    const messages: AbstractIntlMessages = { today: source.today, workspaceHome: source.workspaceHome, runProgress: source.runProgress }
    return createTranslator({ locale: copy.lang, messages, namespace })
  },
}))
vi.mock('next/link', () => ({ default: ({ href, prefetch, children, ...props }: ComponentPropsWithoutRef<'a'> & { href: string; prefetch?: boolean }) => {
  copy.links.push({ href, prefetch })
  return <a href={href} {...props}>{children}</a>
} }))
vi.mock('@/components/dashboard/today/TodayAsk', () => ({ TodayAsk: () => null }))
vi.mock('@/components/reports/MonthlyReportEntry', () => ({ MonthlyReportEntry: () => null }))
vi.mock('@/components/dashboard/overview/OverviewStats', () => ({ OverviewStats: () => null }))
vi.mock('@/components/dashboard/overview/ScoreTrend', () => ({ ScoreTrend: () => null }))
vi.mock('@/components/PillarScoreCards', () => ({ PillarScoreCards: () => null }))
vi.mock('@/components/pulse/RunProgress', () => ({ RunProgress: () => null }))

import { BrandToday } from '@/components/dashboard/today/BrandToday'

function home(overrides: Partial<WorkspaceHome> = {}): WorkspaceHome {
  return {
    client: { id: 'c1', brand_name: 'Example', domain: 'example.com', industry: 'technology', status: 'active' },
    priorities: { state: 'ready', priorities: [], primaryAction: null, needsEvidence: [], observedFindings: 0 },
    nextStep: { kind: 'review_opportunity', labelKey: 'opportunities', href: '/__locale__/dashboard/c1/opportunities' },
    siteHealth: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    history: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    visibility: { state: 'empty', data: null, observedAt: null, freshness: 'unknown' },
    recommendations: { state: 'empty', data: null, observedAt: null, freshness: 'unknown', generated: true },
    ...overrides,
  }
}
const task = (status: TaskRow['status'] = 'draft', title = 'Repair crawl access'): TaskRow => ({ id: 'work-1', title, status, checkKey: null, versionNumber: status === 'draft' ? null : 2, updatedAt: '2026-11-14T00:00:00Z' })
async function hero(workspace: WorkspaceHome): Promise<string> {
  const html = renderToStaticMarkup(await BrandToday({ workspace, lang: copy.lang, chatEnabled: false, clientReportsOnline: false }))
  const start = html.indexOf('<section aria-labelledby="today-action-heading"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}
beforeEach(() => { copy.lang = 'en'; copy.links = [] })

const fixtureStates = ['primary', 'setup', 'scoped', 'recorded', 'unavailable', 'empty', 'dedup', 'long', 'sitefix'] as const
function fixture(state: typeof fixtureStates[number]): WorkspaceHome {
  const workspace = home({ savedWork: { status: 'ok', data: [task()] } })
  if (state === 'setup') workspace.nextStep = { kind: 'confirm_prompts', labelKey: 'configure', href: '/__locale__/dashboard/c1/prompts' }
  if (state === 'scoped') workspace.nextStep = { kind: 'review_run', labelKey: 'repair', href: '/__locale__/dashboard/c1/observations?run=saved&week=2026-11-09#run-status' }
  if (state === 'recorded') workspace.savedWork = { status: 'ok', data: [task('delivered')] }
  if (state === 'unavailable') workspace.savedWork = { status: 'error', data: [task('approved', 'STALE PRIVATE TITLE')] }
  if (state === 'empty') workspace.savedWork = { status: 'ok', data: [] }
  if (state === 'dedup') workspace.nextStep = { kind: 'review_work', labelKey: 'work', href: '/__locale__/dashboard/c1/opportunities?draft=work-1' }
  if (state === 'long') workspace.savedWork = { status: 'ok', data: [task('draft', '檢查並改善公開頁面 '.repeat(12) + 'VeryLongSavedTaskTitle'.repeat(8))] }
  if (state === 'sitefix') {
    workspace.nextStep = { kind: 'start_run', labelKey: 'start', href: '/__locale__/dashboard/c1?step=monitor#first-monitoring' }
    workspace.siteHealth = { state: 'ready', data: { scanId: 'scan-a', domain: 'example.com', score: 62, grade: 'C', pillarScores: null }, observedAt: '2026-11-14T00:00:00Z', freshness: 'unknown' }
    const primaryAction = { checkKey: 'c1_robots', bucket: 'core', assessment: 'fail', pointsAtStake: 12 } as const
    workspace.priorities = { state: 'ready', priorities: [primaryAction], primaryAction, needsEvidence: [], observedFindings: 1 }
  }
  return workspace
}

// Real server-component markup and actual messages, isolated from Auth/providers.
// The existing C8A fixture environment supplies the final build CSS in CI.
afterAll(async () => {
  const directory = process.env.C8A_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  for (const lang of ['en', 'zh-HK']) for (const state of fixtureStates) {
    copy.lang = lang
    const html = renderToStaticMarkup(await BrandToday({ workspace: fixture(state), lang, chatEnabled: false, clientReportsOnline: false }))
    writeFileSync(join(directory, `${lang}-today-${state}.html`), html, 'utf8')
  }
})

describe.each(['en', 'zh-HK'])('saved-work hero with actual %s messages', lang => {
  beforeEach(() => { copy.lang = lang })

  it('keeps setup primary and provides exactly one saved-work continuation', async () => {
    const html = await hero(home({ nextStep: { kind: 'confirm_prompts', labelKey: 'configure', href: '/__locale__/dashboard/c1/prompts' }, savedWork: { status: 'ok', data: [task('in_review')] } }))
    expect(html).toContain(`href="/${lang}/dashboard/c1/prompts"`)
    expect(html).toContain(`href="/${lang}/dashboard/c1/work-items/work-1/versions"`)
    expect((html.match(/<a /g) ?? [])).toHaveLength(2)
    expect(html).toContain(lang === 'en' ? 'Awaiting independent review' : '等待獨立審批')
    expect(html).not.toContain('savedWork.')
    expect(copy.links.filter(link => link.href === `/${lang}/dashboard/c1/work-items/work-1/versions`)).toEqual([{ href: `/${lang}/dashboard/c1/work-items/work-1/versions`, prefetch: false }])
  })

  it('promotes a generic fallback once and escapes the saved title as text', async () => {
    const html = await hero(home({ savedWork: { status: 'ok', data: [task('draft', 'Repair <img src=x onerror=alert(1)>')] } }))
    expect((html.match(/<a /g) ?? [])).toHaveLength(1)
    expect(html).toContain(`href="/${lang}/dashboard/c1/opportunities?draft=work-1"`)
    expect(html).toContain(lang === 'en' ? 'Open task' : '開啟工作')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(copy.links.filter(link => link.href === `/${lang}/dashboard/c1/opportunities?draft=work-1`)).toEqual([{ href: `/${lang}/dashboard/c1/opportunities?draft=work-1`, prefetch: false }])
  })

  it('describes delivered as a record and keeps it secondary', async () => {
    const html = await hero(home({ savedWork: { status: 'ok', data: [task('delivered')] } }))
    expect((html.match(/<a /g) ?? [])).toHaveLength(2)
    expect(html).toContain(lang === 'en' ? 'Open delivery record:' : '查看交付記錄：')
    expect(html).toContain(lang === 'en' ? 'Delivery recorded' : '已記錄交付')
    expect(html).not.toMatch(/verified|已驗證|verified_live/i)
    expect(copy.links.find(link => link.href === `/${lang}/dashboard/c1/work-items/work-1/versions`)?.prefetch).toBe(false)
  })

  it('shows read failure with a Tasks recovery link and never renders stale rows', async () => {
    const html = await hero(home({ savedWork: { status: 'error', data: [task('approved', 'STALE PRIVATE TITLE')] } }))
    expect(html).toContain(lang === 'en' ? 'Could not read saved work.' : '未能讀取已儲存工作。')
    expect(html).toContain(`href="/${lang}/dashboard/c1/tasks"`)
    expect(html).not.toContain('STALE PRIVATE TITLE')
    expect(copy.links.find(link => link.href === `/${lang}/dashboard/c1/tasks`)?.prefetch).toBe(false)
    expect(html).toContain(`href="/${lang}/dashboard/c1/opportunities"`)
  })

  it('keeps one original primary link when the existing saved-work action already has the same destination', async () => {
    const href = `/${lang}/dashboard/c1/opportunities?draft=work-1`
    const html = await hero(home({ nextStep: { kind: 'review_work', labelKey: 'work', href: '/__locale__/dashboard/c1/opportunities?draft=work-1' }, savedWork: { status: 'ok', data: [task()] } }))
    expect((html.match(/<a /g) ?? [])).toHaveLength(1)
    expect(html).toContain('Repair crawl access')
    expect(html).toContain(lang === 'en' ? 'Saved draft' : '已儲存草稿')
    // Dedup keeps the old primary's behavior; only new links opt out of prefetch.
    expect(copy.links.filter(link => link.href === href)).toEqual([{ href, prefetch: undefined }])
  })

  it('does not add secondary labels or links when saved work is absent or actually empty', async () => {
    expect(await hero(home({ savedWork: { status: 'ok', data: [] } }))).toEqual(await hero(home()))
  })
})
