import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

/** Source with comments stripped, so prose cannot satisfy a behavioural check. */
function code(path: string) {
  return read(path)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SIDEBAR = 'components/dashboard/DashboardSidebar.tsx'
const TOPBAR = 'components/dashboard/shell/TopBar.tsx'
const LAYOUT = 'app/[lang]/dashboard/layout.tsx'

// Link targets, locks and reachability live in lib/dashboard-nav.ts and are
// tested in __tests__/lib/dashboard-nav.test.ts; rendering in
// dashboard-sidebar-portfolio.test.tsx. These pin the wiring around them.
describe('dashboard sidebar brand resolution', () => {
  it('no longer depends on the header Next 16 does not set', () => {
    // The layout read `x-invoke-path`, a Next 13-era internal. Nothing in the
    // app sets it and it is gone from Next's own source, so the regex never
    // matched: brandId was permanently undefined, every nav link dropped the
    // brand, and the results entry was locked and unclickable forever.
    expect(code(LAYOUT)).not.toContain('x-invoke-path')
    // Brand resolution belongs to the route params of the client components
    // and must not move back here.
    expect(code(LAYOUT)).not.toContain('const brandId')
  })

  it('reads the brand from the route it renders inside', () => {
    const sidebar = code(SIDEBAR)

    expect(sidebar).toContain('useParams<{ lang: string; clientId?: string }>()')
    expect(sidebar).toContain('const clientId = params?.clientId ?? brandId')
    expect(code(TOPBAR)).toContain('const clientId = params?.clientId ?? null')
  })

  it('takes every link from the shared navigation model', () => {
    // One source for the sidebar, the breadcrumbs and ⌘K, so they cannot disagree.
    for (const file of [SIDEBAR, TOPBAR]) {
      expect(code(file)).toContain('buildDashboardNav({ lang, clientId, features })')
      expect(code(file)).toContain('locateDashboard(')
    }
  })

  it('never blocks a link for a plan limit', () => {
    // An unentitled page renders its own locked card and pricing link, which
    // pointer-events-none would hide.
    expect(code(SIDEBAR)).not.toContain('pointer-events-none')
    expect(code(SIDEBAR)).not.toContain('aria-disabled')
  })
})

describe('navigation copy', () => {
  it('has every section and item label in both locales', () => {
    const keys = ['nav_overview', 'nav_overview_desc', 'nav_scan_fix', 'nav_scan_fix_desc', 'nav_monitor', 'nav_monitor_desc',
      'nav_reports', 'nav_reports_desc', 'nav_settings', 'nav_settings_desc', 'nav_scan', 'nav_results', 'nav_fixes', 'nav_tasks',
      'opportunities', 'observations', 'question_bank', 'competitors', 'cited_sources', 'entity', 'sources', 'nav_assets', 'nav_account',
      'select_brand_first', 'local_visibility']
    for (const locale of ['en', 'zh-HK'] as const) {
      const dashboard = JSON.parse(read(`messages/${locale}.json`)).dashboard
      for (const key of keys) expect(dashboard[key], `${locale} ${key}`).toBeTruthy()
    }
  })
})
