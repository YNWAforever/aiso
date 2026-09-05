import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { workspaceHomeFixture } from '../../tests/fixtures/workspace-home'
import { afterAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceHome } from '@/components/dashboard/WorkspaceHome'
import type { WorkspaceHome as HomeDto } from '@/lib/view-models/workspace-home'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

export const homeFixture = (state: 'ready'|'empty'|'error'|'locked' = 'empty') => {
  const section = { state, data: null, observedAt: null, freshness: 'unknown' as const }
  return { client: { id: 'client-a', brand_name: 'Example Brand', domain: 'example.com', industry: 'technology', status: 'active' }, siteHealth: section, visibility: section, history: section, recommendations: { ...section, generated: true } } as HomeDto
}
describe('workspace home presentation', () => {
  it.each(['en','zh-HK'])('renders honest localized empty, error and locked states in %s', lang => {
    const copy = (lang === 'en' ? en : zh).workspaceHome
    for (const state of ['empty','error','locked'] as const) {
      const html = renderToStaticMarkup(<WorkspaceHome workspace={homeFixture(state)} lang={lang} />)
      expect(html).toContain(copy.states[state])
      expect(html).toContain(copy.freshnessUnknown)
      expect(html).not.toContain('0%')
      expect(html).toContain('Example Brand')
      for (const step of ['scan','results','improve','monitor','roi']) expect(html).toContain(`/dashboard/client-a?step=${step}`)
    }
  })
  it('renders persisted observation dates and labels generated work as draft', () => {
    const workspace = homeFixture()
    workspace.siteHealth = { state: 'ready', data: { scanId: 'scan-a', domain:'example.com', score: 62, grade:'C', pillarScores: null }, observedAt:'2026-09-05T10:00:00.000Z', freshness:'unknown' }
    workspace.recommendations = { state:'ready', data:[{id:'rec-a',scan_id:'scan-a',platform:'chatgpt',category:'content',priority:'high',recommendation:'Add a concise product explanation',impact_score:4,created_at:'2026-09-05T10:00:00.000Z'}],observedAt:'2026-09-05T10:00:00.000Z', freshness:'unknown', generated:true }
    const html = renderToStaticMarkup(<WorkspaceHome workspace={workspace} lang="en" />)
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
    const html = renderToStaticMarkup(<WorkspaceHome workspace={workspaceHomeFixture(state, lang)} lang={lang} />)
    writeFileSync(join(directory, `${lang}-${state}.html`), html, 'utf8')
    writeFileSync(join(directory, `${lang}-copy.json`), JSON.stringify((lang === 'en' ? en : zh).workspaceHome), 'utf8')
  }
})
