import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-origin'
import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { upsertConnection } from '@/lib/integrations/search-console/store'
import { sealToken } from '@/lib/integrations/google/vault'
import { GOOGLE_CONSENT_COOKIE, verifyConsentState } from '@/lib/integrations/google/consent-state'
import type { ConsentErrorReason as Reason } from '@/lib/integrations/google/consent-reasons'
import { SEARCH_CONSOLE_SCOPE, exchangeCode, googleOAuthConfig, type TokenGrant } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

/**
 * Finishes consent (spec §4.1). Every refusal returns the owner to a page that
 * names the reason; nothing is stored unless the connection can actually sync.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = appOrigin().replace(/\/$/, '')
  const consent = verifyConsentState(req.cookies.get(GOOGLE_CONSENT_COOKIE)?.value)
  const back = (reason: Reason | null) => {
    const path = consent?.returnPath ?? '/en/dashboard/settings'
    const query = reason ? `google=error&reason=${reason}` : 'google=connected'
    const res = NextResponse.redirect(`${origin}${path}?${query}`, 302)
    res.cookies.set(GOOGLE_CONSENT_COOKIE, '', { path: '/api/integrations/google', maxAge: 0 })
    return res
  }

  const access = await authorizeSearchConsoleAccount()
  // See start/route.ts: guard.ts's Denied.response is a plain Response shared
  // by every route using this guard shape.
  if (!access.ok) return access.response as NextResponse

  const params = req.nextUrl.searchParams
  if (!consent || params.get('state') !== consent.state) return back('consent_invalid')
  if (consent.profileId !== access.profile.id || consent.accountId !== access.profile.account_id) {
    return back('session_mismatch')
  }
  const code = params.get('code')
  if (!code) return back('denied')

  const cfg = googleOAuthConfig(process.env, origin)
  if (!cfg) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })

  let grant: TokenGrant
  try {
    grant = await exchangeCode(cfg, { code, verifier: consent.verifier })
  } catch {
    return back('unavailable')
  }
  if (!grant.refreshToken) return back('no_refresh_token')
  if (!grant.scopes.includes(SEARCH_CONSOLE_SCOPE)) return back('scope_missing')

  try {
    await upsertConnection({
      accountId: access.profile.account_id,
      profileId: access.profile.id,
      subject: grant.subject,
      email: grant.email,
      scopes: grant.scopes,
      // Bound to this account: a ciphertext copied into another account's row cannot be opened.
      sealed: sealToken(grant.refreshToken, { accountId: access.profile.account_id }),
    })
  } catch {
    // Never report "connected" over a failed write.
    return back('unavailable')
  }
  return back(null)
}
