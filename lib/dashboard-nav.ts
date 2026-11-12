/**
 * The dashboard's information architecture, in one pure module: the sidebar,
 * the ⌘K palette and the breadcrumbs all read it, so a page cannot appear in
 * one and be missing from another. URLs are the existing ones; this only
 * groups them (docs/ux/target-ia.md, Phase 4 decision: keep today's routes).
 *
 * Two IA modes share this file:
 *
 *   legacy (FEATURE_SME_COPILOT_UI off, default)
 *     Overview      ?step=overview (alias of ?step=home) when Conversation Studio
 *                   is enabled, otherwise ?step=home; ?step=roi is a card there
 *     Scan & Fix    ?step=scan · ?step=results · ?step=improve · /opportunities · /tasks
 *     Monitor       hidden until Pulse is scheduled (MONITOR_VISIBLE)
 *     Reports       /reports
 *     Settings      /entities · /sources · /assets · /dashboard/settings
 *
 *   SME copilot (FEATURE_SME_COPILOT_UI=1, approved 2026-11-12)
 *     Today         bare brand URL · ?step=home · ?step=overview · ?step=roi
 *     Chat          /studio (+ threads/weekly/documents/connections/tools)
 *     What AI says  ?step=monitor · observations · prompts · competitors · citations
 *     Improve       ?step=scan · ?step=results · ?step=improve · opportunities · tasks
 *     Reports       /reports · /month · /month/report · /dashboard/this-month
 *     Account       /entities · /sources · /assets · /dashboard/settings · /dashboard/billing
 *                   (avatar menu, not a sidebar destination; hidden section for breadcrumbs)
 */

/**
 * Monitor stays out of the legacy navigation until Pulse is scheduled in
 * production (decision 2026-10-22). Its pages still work for anyone holding a
 * link. The SME copilot IA makes the same pages a visible "What AI says"
 * destination with its honesty notes, so this constant only affects legacy.
 */
export const MONITOR_VISIBLE = false

/**
 * FEATURE ON: a brand dashboard URL with no step (or ?step=home) lands in
 * Conversation Studio instead of WorkspaceHome. WorkspaceHome stays reachable
 * through the explicit ?step=overview alias, so Overview and Studio's back
 * link cannot redirect-loop. Setting this to false restores the WorkspaceHome
 * default without touching the feature flag or the environment. The SME
 * copilot IA (approved 2026-11-12) retires the redirect when it is on.
 */
export const STUDIO_DEFAULT_HOME = true

/** Where a brand dashboard entry point goes for the current feature state. */
export function brandHomeHref({ lang, clientId, conversationStudio = false, smeCopilot = false }: { lang: string; clientId: string; conversationStudio?: boolean; smeCopilot?: boolean }): string {
  const brand = `/${lang}/dashboard/${clientId}`
  if (smeCopilot) return brand
  return conversationStudio ? `${brand}/studio` : `${brand}?step=home`
}

export type SectionKey =
  | 'overview' | 'studio' | 'scan' | 'monitor' | 'reports' | 'settings'
  | 'today' | 'chat' | 'what_ai_says' | 'improve' | 'account'

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

/** The five brand destinations of the approved SME copilot IA. */
const SME_BRAND_SECTIONS: SectionKey[] = ['today', 'chat', 'what_ai_says', 'improve', 'reports']

export interface NavOptions {
  lang: string
  clientId?: string | null
  features: NavFeatures
  scanId?: string | null
  includeHidden?: boolean
  conversationStudio?: boolean
  smeCopilot?: boolean
}

/**
 * `includeHidden` keeps hidden sections (legacy Monitor, SME Account) for
 * breadcrumbs only: their pages still work by URL and need a trail, but must
 * not be advertised.
 */
export function buildDashboardNav({ lang, clientId, features, scanId, includeHidden = false, conversationStudio = false, smeCopilot = false }: NavOptions): NavSection[] {
  const root = `/${lang}/dashboard`
  const account = `${root}/settings`
  if (smeCopilot) return smeNav({ lang, clientId, features, scanId, includeHidden, conversationStudio })
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
    { key: 'overview', labelKey: 'nav_overview', descKey: 'nav_overview_desc', href: conversationStudio ? `${brand}?step=overview` : `${brand}?step=home`, needsBrand: false, items: [] },
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

/** The approved five-destination IA. Pure: no reads, no flags of its own. */
function smeNav({ lang, clientId, features, scanId, includeHidden, conversationStudio }: NavOptions): NavSection[] {
  const root = `/${lang}/dashboard`
  if (!clientId) {
    return [
      { key: 'today', labelKey: 'nav_today', descKey: 'nav_today_desc', href: root, needsBrand: false, items: [] },
      { key: 'reports', labelKey: 'nav_reports', descKey: 'select_brand_first', href: root + BRAND_LIST, needsBrand: true, items: [] },
      { key: 'account', labelKey: 'nav_account', descKey: 'nav_account_desc', href: `${root}/settings`, needsBrand: false, items: [] },
    ]
  }
  const brand = `${root}/${clientId}`
  const sections: NavSection[] = [
    { key: 'today', labelKey: 'nav_today', descKey: 'nav_today_desc', href: brand, needsBrand: false, items: [] },
    ...(conversationStudio ? [{ key: 'chat' as const, labelKey: 'nav_chat', descKey: 'nav_chat_desc', href: `${brand}/studio`, needsBrand: true, items: [] }] : []),
    { key: 'what_ai_says', labelKey: 'nav_what_ai_says', descKey: 'nav_what_ai_says_desc', href: `${brand}?step=monitor`, needsBrand: true, items: [
      { key: 'monitor', labelKey: 'nav_ai_visibility', href: `${brand}?step=monitor` },
      { key: 'observations', labelKey: 'observations', href: `${brand}/observations` },
      { key: 'prompts', labelKey: 'question_bank', href: `${brand}/prompts`, badge: features.edit_prompts ? undefined : 'Pro' },
      { key: 'competitors', labelKey: 'competitors', href: `${brand}/competitors` },
      { key: 'citations', labelKey: 'cited_sources', href: `${brand}/citations` },
    ] },
    { key: 'improve', labelKey: 'nav_improve', descKey: 'nav_improve_desc', href: `${brand}?step=scan`, needsBrand: true, items: [
      { key: 'scan', labelKey: 'nav_scan', href: `${brand}?step=scan` },
      { key: 'results', labelKey: 'nav_results', href: `${brand}?step=results` },
      { key: 'improve', labelKey: 'nav_fixes', href: `${brand}?step=improve`, locked: !features.agent_recs },
      { key: 'opportunities', labelKey: 'opportunities', href: `${brand}/opportunities` },
      { key: 'tasks', labelKey: 'nav_tasks', href: `${brand}/tasks` },
    ] },
    { key: 'reports', labelKey: 'nav_reports', descKey: 'nav_reports_desc', href: `${brand}/reports`, needsBrand: true, items: [
      { key: 'reports', labelKey: 'nav_shared_reports', href: `${brand}/reports` },
      { key: 'month', labelKey: 'nav_monthly_reports', href: `${brand}/month` },
      { key: 'this-month', labelKey: 'nav_all_brands', href: `${root}/this-month` },
    ] },
    // Not a sidebar destination: the avatar menu owns these pages. Kept here so
    // breadcrumbs and the ⌘K palette can still resolve them.
    { key: 'account', labelKey: 'nav_account', descKey: 'nav_account_desc', href: `${brand}/entities`, needsBrand: false, items: [
      { key: 'entities', labelKey: 'nav_brand_profile', href: `${brand}/entities` },
      { key: 'sources', labelKey: 'nav_verified_facts', href: `${brand}/sources` },
      { key: 'assets', labelKey: 'nav_pages', href: `${brand}/assets` },
      { key: 'account', labelKey: 'nav_account', href: `${root}/settings` },
      { key: 'billing', labelKey: 'nav_billing', href: `${root}/billing` },
    ] },
  ]
  const visible = includeHidden ? sections : sections.filter(section => (SME_BRAND_SECTIONS as SectionKey[]).includes(section.key))
  if (!clientId || !scanId) return visible
  // Same rule as the legacy IA: the selected scan rides along on brand tab
  // links, never on the account menu or a brand switch.
  const withScan = (href: string) => href.startsWith(`${brand}?`) || href === `${brand}/reports`
    ? `${href}${href.includes('?') ? '&' : '?'}scanId=${encodeURIComponent(scanId)}` : href
  return visible.map(section => ({ ...section, href: withScan(section.href), items: section.items.map(item => ({ ...item, href: withScan(item.href) })) }))
}

const STEP_LOCATION: Record<string, [SectionKey, string | null]> = {
  home: ['overview', null], overview: ['overview', null], roi: ['overview', 'roi'],
  scan: ['scan', 'scan'], results: ['scan', 'results'], improve: ['scan', 'improve'],
  monitor: ['monitor', 'monitor'],
}

const SME_STEP_LOCATION: Record<string, [SectionKey, string | null]> = {
  home: ['today', null], overview: ['today', null], roi: ['today', 'roi'],
  scan: ['improve', 'scan'], results: ['improve', 'results'], improve: ['improve', 'improve'],
  monitor: ['what_ai_says', 'monitor'],
}

const SEGMENT_LOCATION: Record<string, [SectionKey, string]> = {
  studio: ['studio', 'studio'],
  opportunities: ['scan', 'opportunities'], tasks: ['scan', 'tasks'], 'work-items': ['scan', 'tasks'], result: ['scan', 'results'],
  observations: ['monitor', 'observations'], prompts: ['monitor', 'prompts'], competitors: ['monitor', 'competitors'], citations: ['monitor', 'citations'],
  reports: ['reports', 'reports'], month: ['reports', 'reports'],
  entities: ['settings', 'entities'], sources: ['settings', 'sources'], assets: ['settings', 'assets'],
}

const SME_SEGMENT_LOCATION: Record<string, [SectionKey, string]> = {
  studio: ['chat', 'chat'],
  opportunities: ['improve', 'opportunities'], tasks: ['improve', 'tasks'], 'work-items': ['improve', 'tasks'], result: ['improve', 'results'],
  observations: ['what_ai_says', 'observations'], prompts: ['what_ai_says', 'prompts'], competitors: ['what_ai_says', 'competitors'],
  citations: ['what_ai_says', 'citations'],
  reports: ['reports', 'reports'], month: ['reports', 'month'], 'this-month': ['reports', 'this-month'],
  entities: ['account', 'entities'], sources: ['account', 'sources'], assets: ['account', 'assets'],
}

export interface DashboardLocation { section: SectionKey | null; item: string | null; clientId: string | null }

/**
 * Where a dashboard URL sits in the IA: which section and item to mark current.
 * `smeCopilot` selects the approved five-destination IA; when it is off the
 * legacy mapping is returned unchanged.
 */
export function locateDashboard(pathname: string, step: string | null, smeCopilot = false): DashboardLocation {
  const parts = pathname.split('/').filter(Boolean)
  // [lang, 'dashboard', clientId?, segment?, ...]
  if (parts[1] !== 'dashboard') return { section: null, item: null, clientId: null }
  const third = parts[2]
  if (!third) return smeCopilot ? { section: 'today', item: null, clientId: null } : { section: 'overview', item: null, clientId: null }
  if (smeCopilot) {
    if (third === 'settings') return { section: 'account', item: 'account', clientId: null }
    if (third === 'billing') return { section: 'account', item: 'billing', clientId: null }
    if (third === 'this-month') return { section: 'reports', item: 'this-month', clientId: null }
  }
  if (third === 'settings') return { section: 'settings', item: 'account', clientId: null }
  const segment = parts[3]
  if (!segment) {
    const table = smeCopilot ? SME_STEP_LOCATION : STEP_LOCATION
    const [section, item] = table[step ?? 'home'] ?? (smeCopilot ? ['today', null] : ['overview', null])
    return { section, item, clientId: third }
  }
  const table = smeCopilot ? SME_SEGMENT_LOCATION : SEGMENT_LOCATION
  const [section, item] = table[segment] ?? [null, null]
  return { section, item, clientId: third }
}
