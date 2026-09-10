import type { SourceDto } from './schema'

/**
 * Grounding: answering from the customer's own approved text, or not at all.
 *
 * `listAgentUsableSources` decides WHICH sources a draft may use. This decides
 * what may be said from them, and it deliberately involves no model. A grounded
 * answer is the approved answer, quoted exactly, with a citation naming the
 * source version and content hash it came from. Nothing is paraphrased, because
 * a paraphrase of an approved fact is no longer the approved fact — and the
 * approved fact is what a human signed off.
 *
 * Matching is normalised-exact, never fuzzy. A fuzzy match invents a connection
 * between a question and an answer that nobody approved, and it fails in the
 * worst direction: confidently, on the questions that matter, with a citation
 * that makes the wrong answer look verified. When nothing matches this abstains
 * and names the unanswered question, which is itself a useful product state —
 * "your source pack does not cover this" is exactly the gap an owner should see.
 */

export type GroundingCitation = {
  sourceId: string
  sourceKey: string
  versionNumber: number
  /** Identifies the exact approved text this answer came from. */
  contentHash: string
  entryIndex: number
}

export type GroundedAnswer = {
  state: 'grounded'
  question: string
  /** Verbatim approved text. Never rewritten. */
  answer: string
  citation: GroundingCitation
}

export type Abstention = {
  state: 'abstained'
  question: string
  reason: 'no-permitted-sources' | 'no-supporting-source' | 'conflicting-sources'
  /** Set for a conflict: the approved texts disagree and a human must choose. */
  conflicts?: GroundingCitation[]
}

export type Grounding = GroundedAnswer | Abstention

/**
 * Case, whitespace and trailing punctuation are noise; wording and content are
 * not. Normalising more aggressively than this starts matching questions that are
 * merely similar, which is the failure this module exists to avoid.
 */
export function normalizeQuestion(value: string): string {
  // Whitespace is collapsed and trimmed BEFORE punctuation is stripped. The other
  // order leaves "hours?  " ending in a space, so the trailing-punctuation anchor
  // never matches and the question quietly fails to match "hours".
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[?？！!。．.，,、;；:：]+$/u, '')
    .trim()
}

/**
 * Defence in depth. Callers are expected to pass the result of
 * `listAgentUsableSources`, which already filters; this refuses to proceed if
 * they did not, rather than trusting them to have remembered. It throws rather
 * than filtering, because a caller passing the wrong list has a bug, and silently
 * filtering would hide it while a revoked source sat one refactor away from a
 * draft.
 */
export function assertPermitted(sources: SourceDto[]): void {
  for (const source of sources) {
    if (source.revokedAt !== null) {
      throw new Error(`Source ${source.sourceKey} is revoked and must not reach a draft`)
    }
    if (!source.agentUseAllowed) {
      throw new Error(`Source ${source.sourceKey} is not permitted for agent use`)
    }
    if (!source.current || source.current.approvedAt === null) {
      throw new Error(`Source ${source.sourceKey} has no approved version`)
    }
  }
}

/**
 * Answers one question from approved sources, or abstains.
 *
 * A conflict — two approved sources answering the same question differently — is
 * NOT resolved by picking one. Both are returned and a human decides, because
 * choosing silently would present one customer-approved fact as though it were
 * the only one.
 */
export function groundQuestion(sources: SourceDto[], question: string): Grounding {
  assertPermitted(sources)
  if (!sources.length) return { state: 'abstained', question, reason: 'no-permitted-sources' }

  const wanted = normalizeQuestion(question)
  const matches: { answer: string; citation: GroundingCitation }[] = []

  for (const source of sources) {
    const version = source.current!
    version.entries.forEach((entry, entryIndex) => {
      if (normalizeQuestion(entry.question) !== wanted) return
      matches.push({
        answer: entry.answer,
        citation: {
          sourceId: source.id,
          sourceKey: source.sourceKey,
          versionNumber: version.versionNumber,
          contentHash: version.contentHash,
          entryIndex,
        },
      })
    })
  }

  if (!matches.length) return { state: 'abstained', question, reason: 'no-supporting-source' }

  const distinct = new Set(matches.map(match => match.answer))
  if (distinct.size > 1) {
    return {
      state: 'abstained',
      question,
      reason: 'conflicting-sources',
      conflicts: matches.map(match => match.citation),
    }
  }

  // Identical text in several sources is agreement, not conflict; cite the first.
  return { state: 'grounded', question, answer: matches[0]!.answer, citation: matches[0]!.citation }
}

/** Convenience for a draft that wants several questions answered at once. */
export function groundQuestions(sources: SourceDto[], questions: string[]): Grounding[] {
  return questions.map(question => groundQuestion(sources, question))
}

/**
 * The citations a work version should snapshot, so a revoked or edited source can
 * later be traced to the drafts that relied on it. Only grounded answers
 * contribute — an abstention cites nothing, because it used nothing.
 */
export function citationsOf(grounding: Grounding[]): GroundingCitation[] {
  return grounding.flatMap(entry => (entry.state === 'grounded' ? [entry.citation] : []))
}
