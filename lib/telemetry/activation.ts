import 'server-only'
import { db } from '@/lib/db'

/**
 * Activation, derived rather than emitted.
 *
 * The obvious design is an event stream: fire `first_export` when an export
 * happens, store it, count the rows. It was rejected for three reasons.
 *
 *  1. Every milestone here is "the first time X happened", and X is already a
 *     durable row with a timestamp. An event would be a second, weaker record of
 *     something the database already knows exactly.
 *  2. An event stream needs backfilling to answer anything about the past, and
 *     the plan is explicit that activation must not be backfilled with invented
 *     successes. Deriving reads what actually happened and cannot fabricate.
 *  3. Emitted events drift. A new export path that forgets to fire one makes the
 *     funnel quietly wrong and nothing fails. A derived milestone is correct the
 *     moment the row is written, by whatever path wrote it.
 *
 * What derivation cannot answer is anything never stored — attempts, abandonment,
 * time-on-step. Those genuinely need events, and `funnel-events` already exists
 * for them. This is the milestone half, not the whole funnel.
 */

export const ACTIVATION_MILESTONES = [
  'first_scan',
  'first_workspace',
  'first_source',
  'first_approved_work',
  'first_export',
  'first_declared_delivery',
] as const

export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number]

/**
 * `null` means "has not happened", which is different from "we did not look".
 * A failed read throws rather than reporting nulls, so a database incident can
 * never be mistaken for an account that did nothing.
 */
export type Activation = {
  accountId: string
  observedAt: string
  reached: Record<ActivationMilestone, string | null>
  /**
   * The furthest CONSECUTIVE milestone reached. Consecutive on purpose: an
   * account with an export but no approved work has something wrong with it, and
   * reporting it as "exported" would hide that.
   */
  furthest: ActivationMilestone | null
}

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null

/**
 * One statement, so every milestone is read at the same instant. Six separate
 * queries would let a row land between them and produce a funnel that never
 * existed at any single moment.
 */
export async function readActivation(accountId: string, now = new Date()): Promise<Activation> {
  const sql = db()
  const rows = await sql`
    select
      (select min(created_at) from scans where account_id = ${accountId}) as first_scan,
      (select min(created_at) from clients where account_id = ${accountId}) as first_workspace,
      (select min(created_at) from client_sources where account_id = ${accountId}) as first_source,
      (select min(decided_at) from work_item_decisions
        where account_id = ${accountId} and decision = 'approved') as first_approved_work,
      (select min(exported_at) from work_item_export_events where account_id = ${accountId}) as first_export,
      (select min(recorded_at) from work_item_delivery_events
        where account_id = ${accountId} and kind = 'attest') as first_declared_delivery
  `
  const row = (rows[0] ?? {}) as Record<string, unknown>
  const reached = Object.fromEntries(
    ACTIVATION_MILESTONES.map(milestone => [milestone, iso(row[milestone])]),
  ) as Record<ActivationMilestone, string | null>

  let furthest: ActivationMilestone | null = null
  for (const milestone of ACTIVATION_MILESTONES) {
    if (reached[milestone] === null) break
    furthest = milestone
  }

  return { accountId, observedAt: now.toISOString(), reached, furthest }
}

/**
 * Deliberately NOT a milestone: a comparable recheck.
 *
 * `lib/outcomes` evaluates comparability on read and stores no verdict, so no row
 * exists whose presence means "this account saw a comparable recheck". It could
 * be inferred from a delivery plus a later scan, but that would report an
 * opportunity to recheck as a recheck — the kind of overstatement the whole
 * outcomes module exists to avoid. It becomes derivable if an evaluated outcome
 * is ever persisted.
 */
export const NOT_DERIVABLE = ['first_comparable_recheck'] as const
