import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-origin'
import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { upsertConnection } from '@/lib/integrations/search-console/store'
import { sealToken, VaultError } from '@/lib/integrations/google/vault'
import { GOOGLE_CONSENT_COOKIE, verifyConsentState } from '@/lib/integrations/google/consent-state'
import type { ConsentErrorReason as Reason } from '@/lib/integrations/google/consent-reasons'
import { GoogleApiError, exchangeCode, googleOAuthConfig, type TokenGrant } from '@/lib/integrations/google/oauth'
import { ANALYTICS_SCOPE, SEARCH_CONSOLE_SCOPE, hasScope } from '@/lib/integrations/google/scopes'

export const dynamic = 'force-dynamic'

// Google's own `error` query values (access_denied, invalid_scope, …) — never
// error_description, which is free text Google fills from request parameters.
const ERROR_CODE_RE = /^[a-z_]{1,64}$/

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
  if (!access.ok) return access.response

  const params = req.nextUrl.searchParams
  if (!consent || params.get('state') !== consent.state) return back('consent_invalid')
  if (consent.profileId !== access.profile.id || consent.accountId !== access.profile.account_id) {
    return back('session_mismatch')
  }
  const code = params.get('code')
  if (!code) {
    const errorParam = params.get('error')
    if (errorParam && errorParam !== 'access_denied' && ERROR_CODE_RE.test(errorParam)) {
      console.error('[google/callback] consent denied', { error: errorParam })
    }
    return back('denied')
  }

  const cfg = googleOAuthConfig(process.env, origin)
  if (!cfg) {
    console.error('[google/callback] GOOGLE_OAUTH_CLIENT_ID / _SECRET are not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  let grant: TokenGrant
  try {
    grant = await exchangeCode(cfg, { code, verifier: consent.verifier })
  } catch (error) {
    if (error instanceof GoogleApiError) {
      console.error(
        error.kind === 'misconfigured' ? '[google/callback] google misconfigured' : '[google/callback] code exchange failed',
        { kind: error.kind, status: error.status, code: error.code },
      )
    } else {
      console.error('[google/callback] code exchange failed', { name: error instanceof Error ? error.name : typeof error })
    }
    return back('unavailable')
  }
  if (!grant.refreshToken) return back('no_refresh_token')
  // What the grant must contain follows the product the owner started with.
  if (consent.product === 'analytics') {
    if (!hasScope(grant.scopes, ANALYTICS_SCOPE)) return back('analytics_not_granted')
    if (!hasScope(grant.scopes, SEARCH_CONSOLE_SCOPE)) return back('search_console_not_granted')
  } else if (!hasScope(grant.scopes, SEARCH_CONSOLE_SCOPE)) {
    return back('scope_missing')
  }

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
  } catch (error) {
    // Never log error.message or the error object itself: the Neon driver
    // echoes the connection string, password included, in its own messages.
    console.error('[google/callback] failed to store connection', {
      name: error instanceof Error ? error.name : typeof error,
      ...(error instanceof VaultError ? { code: error.code } : {}),
    })
    // Never report "connected" over a failed write.
    return back('unavailable')
  }
  return back(null)
}
