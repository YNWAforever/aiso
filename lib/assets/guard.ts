import { getProfile } from '@/lib/auth'

export type AssetRegistryAccess =
  | { ok: true; accountId: string; actorId: string }
  | { ok: false; response: Response }

/**
 * The auth preamble the registered-page routes share.
 *
 * Shaped like `lib/prompts/guard.ts`, with one difference stated rather than
 * left to be inferred: **there is no entitlement check here, on either intent.**
 * Registering the pages of your own brand spends no model budget and unlocks no
 * paid capability — it is configuration, like reading your own question bank —
 * and no `PlanFeatures` entry describes it. Inventing one to have something to
 * check would put a new flag through the plan catalogue and every test that
 * pins it, in order to gate something the product does not sell.
 *
 * **Ownership is deliberately not here either.** Every read and every write in
 * `lib/assets/store.ts` carries `account_id` inside its own statement, so there
 * is no window between checking and acting. Adding a separate lookup would
 * create the TOCTOU gap the single statement does not have.
 */
export async function authorizeAssetRegistry(): Promise<AssetRegistryAccess> {
  // Deliberately not wrapped: a session-store outage must surface as a 500, not
  // be flattened into a 401 that reads as "signed out".
  const profile = await getProfile()
  if (!profile) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { ok: true, accountId: profile.account_id, actorId: profile.id }
}
