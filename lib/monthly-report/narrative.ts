import 'server-only'

import { callOpenRouter } from '@/lib/openrouter'
import { validatePolishedText } from '@/lib/reports/ai'
import type { MonthlyReportSnapshotV2 } from './snapshot'

/**
 * Retainer OS Slice C: an AI draft of the monthly report's narrative.
 *
 * The plan's rule is that the narrative is the operator's and any AI wording is
 * a draft they approve; it may restate the record, never add to it. This module
 * therefore hands the model a closed set of stored facts, accepts only plain
 * text whose every number appears in those facts, and never saves anything —
 * the editor puts the result in the textarea and the operator saves it.
 *
 * Percentages stay out of the facts on purpose: the guard refuses `%`, and the
 * share-of-voice figures belong in the visibility table where they carry their
 * platform and dates, not in prose.
 */

export interface MonthlyNarrativeFacts {
  readonly locale: 'en' | 'zh-HK'
  readonly month: string
  readonly currentNarrative: string
  readonly delivered: { verifiedLive: number; selfReported: number }
  readonly visibility: { state: 'not_enough_data' | 'recorded'; rising: number; falling: number; platforms: number }
  readonly search: { state: 'not_connected' | 'not_recorded' | 'recorded'; clicks: number | null; impressions: number | null }
  readonly openItems: number
}

export type MonthlyNarrativeResult = Readonly<{
  narrative: string
  polished: boolean
  code: 'ai_polished' | 'ai_unavailable' | 'ai_invalid_output'
}>

const MODEL = 'anthropic/claude-haiku-4-5'

/** The stored facts an operator could cite, and nothing else. */
export function monthlyNarrativeFacts(snapshot: MonthlyReportSnapshotV2, locale: 'en' | 'zh-HK'): MonthlyNarrativeFacts {
  const visibility = snapshot.visibility
  const search = snapshot.search.closing.state === 'not_recorded' ? snapshot.search.opening : snapshot.search.closing
  return {
    locale,
    month: snapshot.month,
    currentNarrative: snapshot.executiveSummary,
    delivered: { verifiedLive: snapshot.delivered.verifiedLive.length, selfReported: snapshot.delivered.selfReported.length },
    visibility: visibility.state === 'recorded'
      ? {
          state: 'recorded',
          rising: visibility.platforms.filter(p => p.direction === 'up').length,
          falling: visibility.platforms.filter(p => p.direction === 'down').length,
          platforms: visibility.platforms.length,
        }
      : { state: 'not_enough_data', rising: 0, falling: 0, platforms: 0 },
    search: search.state === 'ok'
      ? { state: 'recorded', clicks: search.clicks, impressions: search.impressions }
      : { state: search.state === 'not_connected' ? 'not_connected' : 'not_recorded', clicks: null, impressions: null },
    openItems: snapshot.nextMonth.openWorkItems.length,
  }
}

export async function draftMonthlyNarrative(facts: MonthlyNarrativeFacts): Promise<MonthlyNarrativeResult> {
  const fallback = { narrative: facts.currentNarrative, polished: false } as const
  try {
    const response = await callOpenRouter({
      label: 'monthly_report.narrative_draft',
      model: MODEL,
      maxTokens: 450,
      signal: AbortSignal.timeout(15_000),
      messages: [
        {
          role: 'system',
          content: `Rewrite the client monthly-report narrative for the supplied facts, in ${facts.locale === 'zh-HK' ? 'Traditional Chinese (Hong Kong)' : 'English'}. Return plain text only: no Markdown, HTML, links, currency, percentages, revenue, traffic, rank, or competitor claims. Use only numbers present in the facts, written without thousands separators. Two to four sentences.`,
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    })
    const narrative = validatePolishedText(response, facts)
    return narrative ? { narrative, polished: true, code: 'ai_polished' } : { ...fallback, code: 'ai_invalid_output' }
  } catch {
    return { ...fallback, code: 'ai_unavailable' }
  }
}
