import { describe, expect, it } from 'vitest'
import type { CitationReport } from '@/lib/citations/report'
import { summarizeCitations } from '@/lib/citations/summary'

function report(overrides: Partial<CitationReport> = {}): CitationReport {
  return {
    answers: { withCitations: 19, recordedEmpty: 0, unrecorded: 30 },
    domains: [
      { domain: 'example.com', kind: 'owned', answers: 10, citations: 18, prompts: 4, platforms: ['ChatGPT'] },
      { domain: 'forum.example', kind: 'forum', answers: 4, citations: 9, prompts: 2, platforms: ['Gemini'] },
      { domain: 'gov.example', kind: 'institutional', answers: 2, citations: 2, prompts: 1, platforms: ['Perplexity'] },
      { domain: 'small.example', kind: 'other', answers: 1, citations: 1, prompts: 1, platforms: [] },
    ],
    urls: [],
    gaps: [],
    gapCoverage: { state: 'ready', configuredCompetitors: 2, competitorsWithDomains: 2 },
    weeks: ['2026-11-16'],
    weekly: [],
    query: null,
    pages: null,
    availableKinds: null,
    ...overrides,
  } as CitationReport
}

describe('summarizeCitations', () => {
  it('totals every recorded answer and reports the cited share', () => {
    const summary = summarizeCitations(report())
    expect(summary.total).toBe(49)
    expect(summary.withCitations).toBe(19)
    expect(summary.unrecorded).toBe(30)
    expect(summary.citedShare).toBe(39)
  })

  it('returns the three most cited domains without mutating the report', () => {
    const input = report()
    const summary = summarizeCitations(input)
    expect(summary.topDomains.map(domain => domain.domain)).toEqual(['example.com', 'forum.example', 'gov.example'])
    expect(input.domains[0].domain).toBe('example.com')
  })

  it('does not invent a share when there are no answers', () => {
    const summary = summarizeCitations(report({ answers: { withCitations: 0, recordedEmpty: 0, unrecorded: 0 }, domains: [] }))
    expect(summary.total).toBe(0)
    expect(summary.citedShare).toBeNull()
    expect(summary.topDomains).toEqual([])
  })

  it('passes the oldest-first weekly series through without reordering it', () => {
    const weekly = [
      { week: '2026-11-09', withCitations: 5, recordedEmpty: 1, unrecorded: 0, citations: 9 },
      { week: '2026-11-16', withCitations: 9, recordedEmpty: 0, unrecorded: 2, citations: 14 },
    ]
    expect(summarizeCitations(report({ weekly })).weekly).toEqual(weekly)
  })
})
