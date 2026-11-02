import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-origin'
import { authorizeDriveAccount } from '@/lib/integrations/google-drive/guard'
import { assertVaultConfigured, VaultError } from '@/lib/integrations/google/vault'
import {
  CONSENT_TTL_MS, GOOGLE_DRIVE_CONSENT_COOKIE, RETURN_PATH, signConsentState,
} from '@/lib/integrations/google/consent-state'
import { DRIVE_FILE_SCOPE, buildConsentUrl, googleOAuthConfig, pkcePair, randomState } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

/**
 * Starts a member's own Google Drive consent (drive.file only). It returns on
 * the existing /api/integrations/google/callback, which hands off to the Drive
 * path only when this Drive-signed cookie verifies and its state matches.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await authorizeDriveAccount()
  if (!access.ok) return access.response

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[google-drive/start] GOOGLE_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) {
    console.error('[google-drive/start] GOOGLE_OAUTH_CLIENT_ID / _SECRET are not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const requested = req.nextUrl.searchParams.get('return') ?? ''
  const returnPath = RETURN_PATH.test(requested) ? requested : '/en/dashboard'
  const { verifier, challenge } = pkcePair()
  const state = randomState()

  const res = NextResponse.redirect(buildConsentUrl(cfg, { state, challenge, scope: DRIVE_FILE_SCOPE }), 302)
  res.cookies.set(GOOGLE_DRIVE_CONSENT_COOKIE, signConsentState({
    state, verifier, profileId: access.profile.id, accountId: access.profile.account_id, returnPath,
  }, Date.now(), 'drive'), {
    httpOnly: true,
    secure: true,
    // Lax, not Strict: the cookie must survive Google's top-level redirect back.
    sameSite: 'lax',
    // The shared callback lives under this path.
    path: '/api/integrations/google',
    maxAge: Math.floor(CONSENT_TTL_MS / 1000),
  })
  return res
}
