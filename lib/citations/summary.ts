import type { CitationDomain, CitationReport, CitationWeek } from './report'

/**
 * The citation page used to open with a paragraph containing all three counts
 * and an always-open filter form. This projection gives the page one summary
 * it can render before the table, without re-reading or re-deriving the report.
 */
export type CitationSummary = {
  total: number
  withCitations: number
  recordedEmpty: number
  unrecorded: number
  /** Share of answers that listed at least one source; null when there are none. */
  citedShare: number | null
  topDomains: CitationDomain[]
  /** Oldest first; empty when the report predates the weekly series. */
  weekly: CitationWeek[]
}

export function summarizeCitations(report: CitationReport): CitationSummary {
  const { withCitations, recordedEmpty, unrecorded } = report.answers
  const total = withCitations + recordedEmpty + unrecorded
  return {
    total,
    withCitations,
    recordedEmpty,
    unrecorded,
    citedShare: total > 0 ? Math.round((withCitations / total) * 100) : null,
    topDomains: [...report.domains].sort((a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain)).slice(0, 3),
    weekly: report.weekly ?? [],
  }
}
