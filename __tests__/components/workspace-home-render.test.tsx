import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { workspaceHomeFixture,dailyHomeFixture,nextStepHomeFixture } from '../../tests/fixtures/workspace-home'
import { afterAll, describe, expect, it } from 'vitest'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import { WorkspaceHome } from '@/components/dashboard/WorkspaceHome'
import { buildOwnerPriorities } from '@/lib/view-models/owner-priorities'
import type { WorkspaceHome as HomeDto } from '@/lib/view-models/workspace-home'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

export const homeFixture = (state: 'ready'|'empty'|'error'|'locked' = 'empty') => {
  const section = { state, data: null, observedAt: null, freshness: 'unknown' as const }
  // No evidence envelope in this fixture, so priorities resolve to 'unavailable'
  // -- the honest answer for a scan whose findings cannot be ranked.
  return { client: { id: 'client-a', brand_name: 'Example Brand', domain: 'example.com', industry: 'technology', status: 'active' }, priorities: buildOwnerPriorities(null), siteHealth: section, visibility: section, history: section, recommendations: { ...section, generated: true } } as HomeDto
}
describe('workspace home presentation', () => {
  it.each(['en','zh-HK'])('renders honest localized empty, error and locked states in %s', lang => {
    const copy = (lang === 'en' ? en : zh).workspaceHome
    for (const state of ['empty','error','locked'] as const) {
      const html = renderWithIntl(<WorkspaceHome workspace={homeFixture(state)} lang={lang} />, lang)
      expect(html).toContain(copy.states[state])
      expect(html).toContain(copy.freshnessUnknown)
      expect(html).not.toContain('0%')
      expect(html).toContain('Example Brand')
      for (const step of ['scan','results','improve','roi']) expect(html).toContain(`/dashboard/client-a?step=${step}`)
      // Monitor is hidden until Pulse is scheduled; its page still works by URL.
      expect(html).not.toContain('/dashboard/client-a?step=monitor')
      expect(html).toContain(copy.localVisibility.title)
    }
  })
  it.each(['en','zh-HK'] as const)('shows stat cards, the score trend and the getting-started checklist in %s', lang => {
    const copy = (lang === 'en' ? en : zh).workspaceHome
    const html = renderWithIntl(<WorkspaceHome workspace={workspaceHomeFixture('ready', lang)} lang={lang} />, lang)
    for (const label of [copy.stats.score, copy.stats.fixesLeft, copy.stats.pointsToGain, copy.trend.title, copy.gettingStarted.title]) expect(html).toContain(label)
    expect(html).toContain(copy.gettingStarted.progress.replace('{done}', '2'))
    // One button in the checklist: the current step's.
    expect(html).toContain(`href="/${lang}/dashboard/fixture-client/opportunities">${copy.gettingStarted.steps.fixes.cta}`)
    expect(html).not.toContain(`>${copy.gettingStarted.steps.questions.cta}<`)
    expect(html).toContain('aria-current="step"')
  })
  it('makes the top observed fix the next best action when the next step would open hidden Monitor', () => {
    const workspace = workspaceHomeFixture('ready')
    workspace.priorities = { state: 'ready', priorities: [{ checkKey: 'c1_robots', bucket: 'core', assessment: 'fail', pointsAtStake: 12 }], primaryAction: { checkKey: 'c1_robots', bucket: 'core', assessment: 'fail', pointsAtStake: 12 }, needsEvidence: [], observedFindings: 1 }
    workspace.nextStep = { kind: 'start_run', labelKey: 'start', href: '/__locale__/dashboard/fixture-client?step=monitor#first-monitoring' }
    const html = renderWithIntl(<WorkspaceHome workspace={workspace} lang="en" />, 'en')
    expect(html).toContain(`href="/en/dashboard/fixture-client?step=results&amp;scanId=fixture-scan">${en.workspaceHome.nextAction.fixCta}`)
    expect(html).toContain(en.workspaceHome.nextAction.points.replace('{n}', '12'))
    expect(html).not.toContain('step=monitor')
  })
  it('turns a next step into Monitor into a new scan while Monitor is hidden', () => {
    const workspace = homeFixture()
    workspace.nextStep = { kind: 'start_run', labelKey: 'start', href: '/__locale__/dashboard/client-a?step=monitor#first-monitoring', reasonKey: 'paused' }
    const html = renderWithIntl(<WorkspaceHome workspace={workspace} lang={'en'} />, 'en')
    expect(html).toContain(`href="/en/dashboard/client-a?step=scan">${en.workspaceHome.nextStep.scan}`)
    expect(html).not.toContain(en.runProgress.availabilityReasons.paused)
    expect(html).not.toContain('step=monitor')
  })
  it('renders persisted observation dates and labels generated work as draft', () => {
    const workspace = homeFixture()
    workspace.siteHealth = { state: 'ready', data: { scanId: 'scan-a', domain:'example.com', score: 62, grade:'C', pillarScores: null }, observedAt:'2026-09-05T10:00:00.000Z', freshness:'unknown' }
    workspace.recommendations = { state:'ready', data:[{id:'rec-a',scan_id:'scan-a',platform:'chatgpt',category:'content',priority:'high',recommendation:'Add a concise product explanation',impact_score:4,created_at:'2026-09-05T10:00:00.000Z'}],observedAt:'2026-09-05T10:00:00.000Z', freshness:'unknown', generated:true }
    const html = renderWithIntl(<WorkspaceHome workspace={workspace} lang={'en'} />, 'en')
    expect(html).toContain('62')
    expect(html).toContain('2026-09-05')
    expect(html).toContain(en.workspaceHome.draft)
    expect(html).toContain('Add a concise product explanation')
    expect(html).not.toContain('Published')
  })
})

// Optional offline artifacts for Playwright. Vitest's JSX renderer emits real React
// markup; Playwright's component transform must not evaluate production TSX itself.
afterAll(() => {
  const directory = process.env.C8A_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  for (const lang of ['en','zh-HK']) for (const state of ['empty','error','locked','ready'] as const) {
    const html = renderWithIntl(<WorkspaceHome workspace={workspaceHomeFixture(state, lang)} lang={lang} />, lang)
    writeFileSync(join(directory, `${lang}-${state}.html`), html, 'utf8')
    writeFileSync(join(directory, `${lang}-copy.json`), JSON.stringify((lang === 'en' ? en : zh).workspaceHome), 'utf8')
  }
  for(const lang of ['en','zh-HK'])for(const state of ['partial','free','unknown','classification'] as const){
    writeFileSync(join(directory,`${lang}-daily-${state}.html`),renderWithIntl(<WorkspaceHome workspace={dailyHomeFixture(state,lang)} lang={lang} />, lang),'utf8')
  }
  for(const lang of ['en','zh-HK'])writeFileSync(join(directory,`${lang}-uc75.html`),renderWithIntl(<WorkspaceHome workspace={nextStepHomeFixture('partial',lang,'11111111-1111-4111-8111-111111111111')} lang={lang} />, lang),'utf8')
  for(const lang of ['en','zh-HK'])for(const state of ['unknown','paused','active','missing','pending','partial','source','draft','complete'] as const){
    writeFileSync(join(directory,`${lang}-next-${state}.html`),renderWithIntl(<WorkspaceHome workspace={nextStepHomeFixture(state,lang)} lang={lang} />, lang),'utf8')
  }

})
