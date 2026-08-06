import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'

export type PromptBankAccess =
  | { ok: true; accountId: string }
  | { ok: false; response: Response }

/**
 * The auth and entitlement preamble the question bank routes share.
 *
 * `intent` is the whole gate. Reading the questions being monitored on your own
 * brand's behalf is not the paid capability — gating it would leave the
 * dashboard unable to render for a plan that can see the page — so `'read'`
 * stops after authentication. Editing is Pro+, so `'write'` also requires
 * `edit_prompts`. This is the same asymmetry as the alerts route.
 *
 * Entitlement precedes ownership so an unentitled caller cannot probe which
 * client ids exist on their account, which is why this returns before any query
 * runs and the tests assert zero queries on a 403.
 *
 * **Ownership is deliberately not here.** Every mutation carries
 * `clients.account_id = $n` inside its own statement, so there is no window
 * between checking and writing; folding a separate check in would add a TOCTOU
 * gap that the single statement does not have. The read path has no write to
 * fuse into and does its own lookup.
 *
 * Shaped like lib/localTrust/guard.ts and lib/admin-guard.ts: the caller either
 * gets its context or a ready response to return.
 */
export async function authorizePromptBank(intent: 'read' | 'write'): Promise<PromptBankAccess> {
  // Deliberately not wrapped: a session-store outage must surface as a 500, not
  // be flattened into a 401 that reads as "signed out".
  const profile = await getProfile()
  if (!profile) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (intent === 'write') {
    const { plan, features } = resolveCommercialEntitlement(profile.accounts)
    if (!features.edit_prompts) {
      return {
        ok: false,
        response: Response.json(
          { error: 'UPGRADE_REQUIRED', feature: 'edit_prompts', plan },
          { status: 403 },
        ),
      }
    }
  }

  return { ok: true, accountId: profile.account_id }
}
