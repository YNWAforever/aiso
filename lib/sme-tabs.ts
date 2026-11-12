/**
 * Tab chrome for the two consolidated SME destinations (approved redesign §6.4–6.5).
 *
 * Both destinations reuse the existing pages; this module only says which tabs a
 * path is in, which one is active, and the URL each tab points at. Every href is
 * an existing route, so no redirect, no new page and no behavioural change: the
 * legacy UI simply never renders the bar.
 */
export type SmeSectionId = 'what_ai_says' | 'improve'

export type SmeTabId =
  | 'visibility' | 'answers' | 'citations' | 'competitors' | 'questions'
  | 'scan' | 'results' | 'suggestions' | 'todos'

export type SmeTab = { id: SmeTabId; labelKey: string; href: string }

export type SmeTabState = {
  section: SmeSectionId
  active: SmeTabId
  tabs: SmeTab[]
}

const SECTION_LABEL: Record<SmeSectionId, string> = {
  what_ai_says: 'whatAiSays',
  improve: 'improve',
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
 * The tab state for a brand path, or null when the path is not one of the two
 * consolidated destinations (or is the brand Today / Reports / account pages).
 *
 * `segment` is the path after `/{lang}/dashboard/{clientId}` ('' for the brand
 * home), `step` is `?step=` when present.
 */
export function smeTabState(input: { base: string; segment: string; step: string | null }): SmeTabState | null {
  const { base, segment, step } = input
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

export function smeSectionLabelKey(section: SmeSectionId): string {
  return SECTION_LABEL[section]
}
