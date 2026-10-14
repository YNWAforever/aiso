import type { NeonQueryFunction } from '@neondatabase/serverless'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'

type Sql = NeonQueryFunction<false, false>

export type AgentRequirements = {
  agent_recs?: boolean
  agent_progress?: boolean
  agent_competitors?: boolean
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, mirroring pulse/run's guard — an
 * unset var can never make an absent header match.
 */
export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

/**
 * Complete a queued scan when every agent output required by its plan has
 * arrived. New scans persist the exact requirements in results; old scans
 * resolve them from the account's current commercial entitlement.
 *
 * Best-effort, deliberately: each caller has already persisted its payload.
 * A failure means status lags reality, not that the caller's data was lost.
 */
export async function markCompleteIfAllPresent(
  sql: Sql,
  scanId: string,
  accountId: string,
  requirements?: AgentRequirements | null,
): Promise<void> {
  try {
    let effectiveRequirements = requirements
    if (requirements === null) {
      const [account] = await sql`
        select plan, status, stripe_subscription_id, trial_ends_at, override_plan, override_expires_at
        from accounts
        where id = ${accountId}
        limit 1
      `
      if (account) {
        const features = resolveCommercialEntitlement(account as CommercialAccount).features
        effectiveRequirements = {
          agent_recs: features.agent_recs,
          agent_progress: features.agent_progress,
          agent_competitors: features.agent_competitors,
        }
      }
    }

    // Missing metadata from an unknown/legacy caller is conservative: require
    // all three outputs rather than marking an incomplete scan as complete.
    const needsRecommendations = effectiveRequirements?.agent_recs !== false
    const needsProgress = effectiveRequirements?.agent_progress !== false
    const needsCompetitors = effectiveRequirements?.agent_competitors !== false

    const [recs, progress, competitors] = await Promise.all([
      needsRecommendations
        ? sql`select 1 from agent_recommendations r join scans s on s.id = r.scan_id where r.scan_id = ${scanId} and s.account_id = ${accountId} limit 1`
        : Promise.resolve([]),
      needsProgress
        ? sql`select 1 from agent_progress p join scans s on s.id = p.scan_id where p.scan_id = ${scanId} and s.account_id = ${accountId} limit 1`
        : Promise.resolve([]),
      needsCompetitors
        ? sql`select 1 from agent_competitors c join scans s on s.id = c.scan_id where c.scan_id = ${scanId} and s.account_id = ${accountId} limit 1`
        : Promise.resolve([]),
    ])

    if ((!needsRecommendations || recs.length > 0)
      && (!needsProgress || progress.length > 0)
      && (!needsCompetitors || competitors.length > 0)) {
      await sql`
        update scans set agent_status = 'complete'
        where id = ${scanId} and account_id = ${accountId}
      `
    }
  } catch (error) {
    console.error('[lib/agents] markCompleteIfAllPresent failed:', error)
  }
}