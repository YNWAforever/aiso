import { NextResponse, type NextRequest } from 'next/server'
import { GOOGLE_DRIVE_CONSENT_COOKIE, type ConsentState } from '@/lib/integrations/google/consent-state'
import type { ConsentErrorReason as Reason } from '@/lib/integrations/google/consent-reasons'
import { DRIVE_FILE_SCOPE, GoogleApiError, exchangeCode, googleOAuthConfig, type TokenGrant } from '@/lib/integrations/google/oauth'
import { sealToken, VaultError } from '@/lib/integrations/google/vault'
import { authorizeDriveAccount, driveVaultPurpose } from './guard'
import { upsertDriveConnection } from './store'

const ERROR_CODE_RE = /^[a-z_]{1,64}$/

/**
 * Finishes a Drive consent on the shared Google callback. The caller has
 * already verified the Drive-signed consent cookie and matched `state`; this
 * never touches the Search Console path or its gate. Nothing is stored unless
 * Google granted drive.file and a refresh token.
 */
export async function finishDriveConsent(req: NextRequest, consent: ConsentState, origin: string): Promise<NextResponse> {
  const back = (reason: Reason | null) => {
    const query = reason ? `drive=error&reason=${reason}` : 'drive=connected'
    const res = NextResponse.redirect(`${origin}${consent.returnPath}?${query}`, 302)
    res.cookies.set(GOOGLE_DRIVE_CONSENT_COOKIE, '', { path: '/api/integrations/google', maxAge: 0 })
    return res
  }

  const access = await authorizeDriveAccount()
  if (!access.ok) return access.response
  if (consent.profileId !== access.profile.id || consent.accountId !== access.profile.account_id) {
    return back('session_mismatch')
  }

  const params = req.nextUrl.searchParams
  const code = params.get('code')
  if (!code) {
    const errorParam = params.get('error')
    if (errorParam && errorParam !== 'access_denied' && ERROR_CODE_RE.test(errorParam)) {
      console.error('[google-drive/callback] consent denied', { error: errorParam })
    }
    return back('denied')
  }

  const cfg = googleOAuthConfig(process.env, origin)
  if (!cfg) {
    console.error('[google-drive/callback] GOOGLE_OAUTH_CLIENT_ID / _SECRET are not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  let grant: TokenGrant
  try {
    grant = await exchangeCode(cfg, { code, verifier: consent.verifier })
  } catch (error) {
    console.error('[google-drive/callback] code exchange failed', error instanceof GoogleApiError
      ? { kind: error.kind, status: error.status, code: error.code }
      : { name: error instanceof Error ? error.name : typeof error })
    return back('unavailable')
  }
  if (!grant.refreshToken) return back('no_refresh_token')
  if (!grant.scopes.includes(DRIVE_FILE_SCOPE)) return back('scope_missing')

  try {
    await upsertDriveConnection({
      accountId: access.profile.account_id,
      profileId: access.profile.id,
      subject: grant.subject,
      email: grant.email,
      scopes: grant.scopes,
      sealed: sealToken(grant.refreshToken, {
        accountId: access.profile.account_id,
        purpose: driveVaultPurpose(access.profile.id),
      }),
    })
  } catch (error) {
    // Never log error.message: the Neon driver echoes the connection string.
    console.error('[google-drive/callback] failed to store connection', {
      name: error instanceof Error ? error.name : typeof error,
      ...(error instanceof VaultError ? { code: error.code } : {}),
    })
    // Never report "connected" over a failed write.
    return back('unavailable')
  }
  return back(null)
}
