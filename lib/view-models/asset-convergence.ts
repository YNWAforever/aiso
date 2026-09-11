/**
 * AC-06's asset half: the point where a website finding and a question
 * opportunity reach the same registered page.
 *
 * Two sides, two different kinds of evidence, and the difference is preserved
 * rather than flattened:
 *
 *  - A **scan finding** attaches by origin. `origin-only.v1` keeps no path, so
 *    the finding was observed for the SITE. It is listed under a page because
 *    the page is on that site, and it carries `scope: 'site'` to say exactly
 *    that. Presenting it as a page-level observation would invent evidence that
 *    was never collected.
 *  - A **question** attaches because the owner declared that this page answers
 *    it. That is a page-level claim, made by a person, and carries
 *    `scope: 'page'`.
 *
 * One site finding therefore attaches to every registered page on its origin.
 * That is not duplication to be cleaned up: the finding really does apply to
 * each of them, and dropping it from the second would under-report the site.
 *
 * This is the asset half only. Nothing here merges two sources onto one work
 * item — `evidence_work_items` is single-source by CHECK constraint, and
 * `saveAuthenticatedDraft` returns an existing draft by opportunity key before
 * it validates a second source, so a merged row would describe one source while
 * claiming to represent two.
 */

import { buildOwnerPriorities } from '@/lib/view-models/owner-priorities'

export type RegisteredAsset = { id: string; url: string; origin: string; label: string }
export type SiteFinding = { origin: string; checkKey: string; status: 'warn' | 'fail' }
export type QuestionDeclaration = { assetId: string; promptId: string; question: string }

export type AssetConvergence = {
  asset: RegisteredAsset
  findings: Array<{ checkKey: string; status: 'warn' | 'fail'; scope: 'site' }>
  questions: Array<{ promptId: string; question: string; scope: 'page' }>
  /** Both kinds present. One kind alone is a page with half a story, not convergence. */
  converges: boolean
}

export function buildAssetConvergence(input: {
  assets: RegisteredAsset[]
  findings: SiteFinding[]
  declarations: QuestionDeclaration[]
}): AssetConvergence[] {
  return [...input.assets]
    .sort((a, b) => a.label.localeCompare(b.label) || a.url.localeCompare(b.url))
    .map(asset => {
      const findings = input.findings
        .filter(found => found.origin === asset.origin)
        .map(found => ({ checkKey: found.checkKey, status: found.status, scope: 'site' as const }))
        .sort((a, b) => a.checkKey.localeCompare(b.checkKey))

      const questions = input.declarations
        .filter(declared => declared.assetId === asset.id)
        .map(declared => ({ promptId: declared.promptId, question: declared.question, scope: 'page' as const }))
        .sort((a, b) => a.question.localeCompare(b.question))

      return { asset, findings, questions, converges: findings.length > 0 && questions.length > 0 }
    })
}

/**
 * The scan side of the join, taken from the reviewed projection rather than
 * re-derived.
 *
 * `buildOwnerPriorities` already decides what counts as an observed finding, and
 * refuses to rank a check the scan could not observe. Re-reading the raw checks
 * here would be a second, weaker answer to the same question — and the first
 * time the two disagreed, this page would be the one inventing findings.
 *
 * Returns nothing when there is no origin to match on. A finding with no origin
 * cannot be attached to a page without guessing which site it belongs to.
 */
export function siteFindingsFromEvidence(evidence: unknown): SiteFinding[] {
  const priorities = buildOwnerPriorities(evidence)
  if (priorities.state !== 'ready') return []

  const envelope = evidence as { final?: { origin?: string | null }; evaluated?: { origin?: string | null } }
  // `final` is where the scan ended up after redirects; `evaluated` is where it
  // was pointed. A finding belongs to the page that answered.
  const origin = envelope?.final?.origin ?? envelope?.evaluated?.origin ?? null
  if (!origin) return []

  return priorities.priorities.map(priority => ({
    origin,
    checkKey: priority.checkKey,
    status: priority.assessment,
  }))
}
