/**
 * Tab chrome for the two consolidated SME destinations (approved redesign §6.4–6.5).
 *
 * Both destinations reuse the existing pages; this module only says which tabs a
 * path is in, which one is active, and the URL each tab points at. Every href is
 * an existing route, so no redirect, no new page and no behavioural change: the
 * legacy UI simply never renders the bar.
 */
export type SmeSectionId = 'what_ai_says' | 'improve' | 'reports'

export type SmeTabId =
  | 'visibility' | 'answers' | 'citations' | 'competitors' | 'questions'
  | 'scan' | 'results' | 'suggestions' | 'todos'
  | 'shareable' | 'monthly' | 'allBrands'

export type SmeTab = { id: SmeTabId; labelKey: string; href: string }

export type SmeTabState = {
  section: SmeSectionId
  active: SmeTabId
  tabs: SmeTab[]
}

const SECTION_LABEL: Record<SmeSectionId, string> = {
  what_ai_says: 'whatAiSays',
  improve: 'improve',
  reports: 'reports',
}

function whatAiSaysTabs(base: string): SmeTab[] {
  return [
    { id: 'visibility', labelKey: 'visibility', href: `${base}?step=monitor` },
    { id: 'answers', labelKey: 'answers', href: `${base}/observations` },
    { id: 'citations', labelKey: 'citations', href: `${base}/citations` },
    { id: 'competitors', labelKey: 'competitors', href: `${base}/competitors` },
    { id: 'questions', labelKey: 'questions', href: `${base}/prompts` },
  ]
}

function improveTabs(base: string): SmeTab[] {
  return [
    { id: 'scan', labelKey: 'scan', href: `${base}?step=scan` },
    { id: 'results', labelKey: 'results', href: `${base}?step=results` },
    { id: 'suggestions', labelKey: 'suggestions', href: `${base}?step=improve` },
    { id: 'todos', labelKey: 'todos', href: `${base}/tasks` },
  ]
}

/**
 * The tab state for a brand path, or null when the path is not one of the three
 * consolidated destinations (or is the brand Today / Chat / account pages).
 *
 * `segment` is the path after `/{lang}/dashboard/{clientId}` ('' for the brand
 * home), `step` is `?step=` when present, `accountBase` is the account-level
 * Reports queue (no brand id).
 */
export function smeTabState(input: { base: string; segment: string; step: string | null; accountBase?: string }): SmeTabState | null {
  const { base, segment, step, accountBase } = input
  if (segment === 'reports' || segment.startsWith('reports/')) return { section: 'reports', active: 'shareable', tabs: reportsTabs(base, accountBase) }
  if (segment === 'month' || segment === 'month/report') return { section: 'reports', active: 'monthly', tabs: reportsTabs(base, accountBase) }
  if (segment === '') {
    if (step === 'monitor') return { section: 'what_ai_says', active: 'visibility', tabs: whatAiSaysTabs(base) }
    if (step === 'scan' || step === 'results' || step === 'improve') {
      const active: SmeTabId = step === 'scan' ? 'scan' : step === 'results' ? 'results' : 'suggestions'
      return { section: 'improve', active, tabs: improveTabs(base) }
    }
    return null
  }
  if (segment === 'observations') return { section: 'what_ai_says', active: 'answers', tabs: whatAiSaysTabs(base) }
  if (segment === 'citations') return { section: 'what_ai_says', active: 'citations', tabs: whatAiSaysTabs(base) }
  if (segment === 'competitors') return { section: 'what_ai_says', active: 'competitors', tabs: whatAiSaysTabs(base) }
  if (segment === 'prompts') return { section: 'what_ai_says', active: 'questions', tabs: whatAiSaysTabs(base) }
  if (segment === 'opportunities') return { section: 'improve', active: 'suggestions', tabs: improveTabs(base) }
  if (segment === 'tasks') return { section: 'improve', active: 'todos', tabs: improveTabs(base) }
  return null
}

function reportsTabs(base: string, accountBase?: string): SmeTab[] {
  return [
    { id: 'shareable', labelKey: 'shareableReports', href: `${base}/reports` },
    { id: 'monthly', labelKey: 'monthlyReport', href: `${base}/month` },
    { id: 'allBrands', labelKey: 'allBrands', href: accountBase ?? `${base}/reports` },
  ]
}

export function smeSectionLabelKey(section: SmeSectionId): string {
  return SECTION_LABEL[section]
}
