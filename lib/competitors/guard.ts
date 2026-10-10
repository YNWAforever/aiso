import { getProfile } from '@/lib/auth'

export type CompetitorAccess =
  | { ok: true; accountId: string }
  | { ok: false; response: Response }

/**
 * The preamble the competitors routes share: authentication, nothing more.
 *
 * There is deliberately no plan check. Competitors are set during onboarding
 * on every plan (AddBrandWizard), so editing them is not a paid capability;
 * the cost they influence is gated where it is spent, in Pulse
 * (`runtimePlatformsFor`). Ownership is not here either: every statement
 * carries `account_id` itself, as in lib/prompts/guard.ts.
 */
export async function authorizeCompetitors(): Promise<CompetitorAccess> {
  // Not wrapped: a session-store outage must surface as a 500, not a 401.
  const profile = await getProfile()
  if (!profile) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { ok: true, accountId: profile.account_id }
}
