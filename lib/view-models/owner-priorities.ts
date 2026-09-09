import { CORE_PTS, EXT_PTS, GEO_PTS } from '@/lib/scoring'
import { readScanEvidence, type CollectionState, type EvidenceCheckKey } from '@/lib/scan-evidence'

/**
 * The owner's three priorities and one next action.
 *
 * Home answers "what should I do now?", so it has to rank findings — but ranking
 * on a check's pass/warn/fail status alone conflates two different things.
 * `deriveQuickWins` in lib/impact.ts does exactly that, which is defensible on
 * the public result page where the reader is judging a score, and wrong here,
 * where the reader is being told what to go and fix.
 *
 * A check can read `fail` because the site genuinely lacks something, or because
 * the scan could not collect the evidence — a blocked fetch, an unsupported
 * response, a timeout. The first is a finding. The second is not a finding at
 * all; it is a gap in what was looked at, and presenting it as work invents a
 * problem the owner may not have.
 *
 * So the collection state decides, not the verdict:
 *   collection 'complete' + fail/warn -> a priority, ranked by points at stake
 *   any other collection              -> needsEvidence, never a priority
 *   no evidence envelope at all       -> insufficient-evidence, no priorities
 *
 * That last case matters most. Scans written before the evidence envelope
 * existed carry check verdicts and no collection states. Falling back to the raw
 * verdicts would quietly turn "we could not look" into "you failed", for exactly
 * the historical rows nobody can re-verify.
 */

export type PriorityBucket = 'core' | 'extended' | 'geo'

export type OwnerPriority = {
  checkKey: EvidenceCheckKey
  bucket: PriorityBucket
  /** Only ever an observed negative verdict. */
  assessment: 'fail' | 'warn'
  /** Points this check is currently forfeiting, on the 100-point scale. */
  pointsAtStake: number
}

export type UnobservedCheck = { checkKey: EvidenceCheckKey; collection: CollectionState }

export type OwnerPriorities = {
  /**
   * ready                 — at least one observed finding
   * all-clear             — evidence is complete and nothing is failing
   * insufficient-evidence — nothing was observed well enough to rank
   * unavailable           — no readable scan evidence at all
   */
  state: 'ready' | 'all-clear' | 'insufficient-evidence' | 'unavailable'
  /** At most three, highest points at stake first. */
  priorities: OwnerPriority[]
  /** The single next action: the top priority, or null when there is nothing to do. */
  primaryAction: OwnerPriority | null
  /** Checks the scan could not observe. Not findings, and never counted as zero. */
  needsEvidence: UnobservedCheck[]
  /** Total observed findings, so "3 of 11" can be said honestly. */
  observedFindings: number
}

export const MAX_PRIORITIES = 3

const WEIGHTS: Record<PriorityBucket, Record<string, number>> = {
  core: CORE_PTS,
  extended: EXT_PTS,
  geo: GEO_PTS,
}

function bucketOf(key: string): { bucket: PriorityBucket; weight: number } | null {
  for (const bucket of ['core', 'extended', 'geo'] as const) {
    const weight = WEIGHTS[bucket][key]
    if (weight !== undefined) return { bucket, weight }
  }
  return null
}

const empty = (state: OwnerPriorities['state'], needsEvidence: UnobservedCheck[] = []): OwnerPriorities =>
  ({ state, priorities: [], primaryAction: null, needsEvidence, observedFindings: 0 })

/**
 * Pure: takes the stored evidence envelope and returns what to show. Reads no
 * database and makes no network call, so the caller owns tenancy.
 */
export function buildOwnerPriorities(evidence: unknown): OwnerPriorities {
  const envelope = readScanEvidence(evidence)
  if (!envelope) return empty('unavailable')

  const findings: OwnerPriority[] = []
  const needsEvidence: UnobservedCheck[] = []

  for (const [key, check] of Object.entries(envelope.checks)) {
    const weighted = bucketOf(key)
    // A key carrying no weight is not scored, so it cannot be points at stake.
    if (!weighted) continue
    if (check.collection !== 'complete') {
      needsEvidence.push({ checkKey: key as EvidenceCheckKey, collection: check.collection })
      continue
    }
    if (check.assessment !== 'fail' && check.assessment !== 'warn') continue
    findings.push({
      checkKey: key as EvidenceCheckKey,
      bucket: weighted.bucket,
      assessment: check.assessment,
      // A warn already earns half its weight, so only half is still at stake.
      pointsAtStake: check.assessment === 'fail' ? weighted.weight : weighted.weight / 2,
    })
  }

  if (!findings.length) {
    // Nothing failing is only good news when we actually looked. If every check
    // was unobservable, "all clear" would be a fabrication.
    return empty(needsEvidence.length ? 'insufficient-evidence' : 'all-clear', needsEvidence)
  }

  // Points at stake first, check key second, so equal-weight findings order
  // deterministically rather than by object insertion.
  findings.sort((a, b) => b.pointsAtStake - a.pointsAtStake || a.checkKey.localeCompare(b.checkKey))
  const priorities = findings.slice(0, MAX_PRIORITIES)

  return {
    state: 'ready',
    priorities,
    primaryAction: priorities[0] ?? null,
    needsEvidence,
    observedFindings: findings.length,
  }
}
