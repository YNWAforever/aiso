/**
 * The dashboard's information architecture, in one pure module: the sidebar,
 * the ⌘K palette and the breadcrumbs all read it, so a page cannot appear in
 * one and be missing from another. URLs are the existing ones; this only
 * groups them (docs/ux/target-ia.md, Phase 4 decision: keep today's routes).
 *
 *   Overview      ?step=home (Local visibility, ?step=roi, is a card there)
 *   Scan & Fix    ?step=scan · ?step=results · ?step=improve · /opportunities · /tasks
 *   Monitor       hidden until Pulse is scheduled (MONITOR_VISIBLE)
 *   Reports       /reports
 *   Settings      /entities · /sources · /assets · /dashboard/settings
 */

/**
 * Monitor stays out of the navigation until Pulse is scheduled in production
 * (decision 2026-10-22). Its pages still work for anyone holding a link.
 */
export const MONITOR_VISIBLE = false

export type SectionKey = 'overview' | 'studio' | 'scan' | 'monitor' | 'reports' | 'settings'

export interface NavItem {
  key: string
  labelKey: string
  href: string
  /** The plan does not include it: shown with a lock, still clickable (the page carries the upgrade path). */
  locked?: boolean
  /** A short badge, e.g. "Pro" on the question bank for plans without prompt editing. */
  badge?: string
}

export interface NavSection {
  key: SectionKey
  labelKey: string
  descKey: string
  href: string
  /** Its pages need a brand in the route; without one the link goes to the brand list. */
  needsBrand: boolean
  items: NavItem[]
}

export interface NavFeatures {
  agent_recs?: boolean
  edit_prompts?: boolean
}

const BRAND_LIST = '#portfolio-brands'

/**
 * `includeHidden` keeps hidden sections (Monitor) for breadcrumbs only: their
 * pages still work by URL and need a trail, but must not be advertised.
 */
export function buildDashboardNav({ lang, clientId, features, scanId, includeHidden = false, conversationStudio = false }: { lang: string; clientId?: string | null; features: NavFeatures; scanId?: string | null; includeHidden?: boolean; conversationStudio?: boolean }): NavSection[] {
  const root = `/${lang}/dashboard`
  const account = `${root}/settings`
  if (!clientId) {
    return [
      { key: 'overview', labelKey: 'nav_overview', descKey: 'nav_overview_desc', href: root, needsBrand: false, items: [] },
      { key: 'scan', labelKey: 'nav_scan_fix', descKey: 'select_brand_first', href: root + BRAND_LIST, needsBrand: true, items: [] },
      ...(MONITOR_VISIBLE ? [{ key: 'monitor' as const, labelKey: 'nav_monitor', descKey: 'select_brand_first', href: root + BRAND_LIST, needsBrand: true, items: [] }] : []),
      { key: 'reports', labelKey: 'nav_reports', descKey: 'select_brand_first', href: root + BRAND_LIST, needsBrand: true, items: [] },
      { key: 'settings', labelKey: 'nav_settings', descKey: 'nav_settings_desc', href: account, needsBrand: false,
        items: [{ key: 'account', labelKey: 'nav_account', href: account }] },
    ]
  }
  const brand = `${root}/${clientId}`
  const sections: NavSection[] = [
    { key: 'overview', labelKey: 'nav_overview', descKey: 'nav_overview_desc', href: `${brand}?step=home`, needsBrand: false, items: [] },
    ...(conversationStudio ? [{ key: 'studio' as const, labelKey: 'nav_start_work', descKey: 'nav_start_work_desc', href: `${brand}/studio`, needsBrand: true, items: [] }] : []),
    { key: 'scan', labelKey: 'nav_scan_fix', descKey: 'nav_scan_fix_desc', href: `${brand}?step=scan`, needsBrand: true, items: [
      { key: 'scan', labelKey: 'nav_scan', href: `${brand}?step=scan` },
      { key: 'results', labelKey: 'nav_results', href: `${brand}?step=results` },
      { key: 'improve', labelKey: 'nav_fixes', href: `${brand}?step=improve`, locked: !features.agent_recs },
      { key: 'opportunities', labelKey: 'opportunities', href: `${brand}/opportunities` },
      { key: 'tasks', labelKey: 'nav_tasks', href: `${brand}/tasks` },
    ] },
    { key: 'monitor', labelKey: 'nav_monitor', descKey: 'nav_monitor_desc', href: `${brand}?step=monitor`, needsBrand: true, items: [
      { key: 'monitor', labelKey: 'nav_monitor', href: `${brand}?step=monitor` },
      { key: 'observations', labelKey: 'observations', href: `${brand}/observations` },
      { key: 'prompts', labelKey: 'question_bank', href: `${brand}/prompts`, badge: features.edit_prompts ? undefined : 'Pro' },
      { key: 'competitors', labelKey: 'competitors', href: `${brand}/competitors` },
      { key: 'citations', labelKey: 'cited_sources', href: `${brand}/citations` },
    ] },
    { key: 'reports', labelKey: 'nav_reports', descKey: 'nav_reports_desc', href: `${brand}/reports`, needsBrand: true, items: [] },
    { key: 'settings', labelKey: 'nav_settings', descKey: 'nav_settings_desc', href: `${brand}/entities`, needsBrand: false, items: [
      { key: 'entities', labelKey: 'entity', href: `${brand}/entities` },
      { key: 'sources', labelKey: 'sources', href: `${brand}/sources` },
      { key: 'assets', labelKey: 'nav_assets', href: `${brand}/assets` },
      { key: 'account', labelKey: 'nav_account', href: account },
    ] },
  ]
  const visible = MONITOR_VISIBLE || includeHidden ? sections : sections.filter(section => section.key !== 'monitor')
  if (!scanId) return visible
  // Context belongs only to this brand. Account settings and brand-switch links
  // deliberately start without it; the destination still validates ownership.
  const withScan = (href: string) => href.startsWith(`${brand}?`) || href === `${brand}/reports`
    ? `${href}${href.includes('?') ? '&' : '?'}scanId=${encodeURIComponent(scanId)}` : href
  return visible.map(section => ({ ...section, href: withScan(section.href), items: section.items.map(item => ({ ...item, href: withScan(item.href) })) }))
}

const STEP_LOCATION: Record<string, [SectionKey, string | null]> = {
  home: ['overview', null], roi: ['overview', 'roi'],
  scan: ['scan', 'scan'], results: ['scan', 'results'], improve: ['scan', 'improve'],
  monitor: ['monitor', 'monitor'],
}

const SEGMENT_LOCATION: Record<string, [SectionKey, string]> = {
  studio: ['studio', 'studio'],
  opportunities: ['scan', 'opportunities'], tasks: ['scan', 'tasks'], 'work-items': ['scan', 'tasks'], result: ['scan', 'results'],
  observations: ['monitor', 'observations'], prompts: ['monitor', 'prompts'], competitors: ['monitor', 'competitors'], citations: ['monitor', 'citations'],
  reports: ['reports', 'reports'],
  entities: ['settings', 'entities'], sources: ['settings', 'sources'], assets: ['settings', 'assets'],
}

export interface DashboardLocation { section: SectionKey | null; item: string | null; clientId: string | null }

/** Where a dashboard URL sits in the IA: which section and item to mark current. */
export function locateDashboard(pathname: string, step: string | null): DashboardLocation {
  const parts = pathname.split('/').filter(Boolean)
  // [lang, 'dashboard', clientId?, segment?, ...]
  if (parts[1] !== 'dashboard') return { section: null, item: null, clientId: null }
  const third = parts[2]
  if (!third) return { section: 'overview', item: null, clientId: null }
  if (third === 'settings') return { section: 'settings', item: 'account', clientId: null }
  const segment = parts[3]
  if (!segment) {
    const [section, item] = STEP_LOCATION[step ?? 'home'] ?? ['overview', null]
    return { section, item, clientId: third }
  }
  const [section, item] = SEGMENT_LOCATION[segment] ?? [null, null]
  return { section, item, clientId: third }
}
