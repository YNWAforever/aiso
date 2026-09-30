import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-origin'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { authorizeSearchConsoleAccount } from '@/lib/integrations/search-console/guard'
import { assertVaultConfigured, VaultError } from '@/lib/integrations/google/vault'
import {
  CONSENT_TTL_MS, GOOGLE_CONSENT_COOKIE, RETURN_PATH, signConsentState,
} from '@/lib/integrations/google/consent-state'
import { buildConsentUrl, googleOAuthConfig, pkcePair, randomState } from '@/lib/integrations/google/oauth'
import { scopesFor, type GoogleProduct } from '@/lib/integrations/google/scopes'
import { listConnections } from '@/lib/integrations/search-console/store'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lets Google's account chooser open on the account that already holds the
 * connection, so adding Analytics does not land on a different Google identity.
 * Looked up through the caller's own account, so another account's connection id
 * yields nothing. It is only a hint: any failure omits it and never fails the request.
 */
async function loginHintFor(accountId: string, connection: string | null): Promise<string | undefined> {
  if (!connection || !UUID.test(connection)) return undefined
  try {
    const mine = await listConnections(accountId)
    return mine.find(c => c.id.toLowerCase() === connection.toLowerCase())?.googleEmail ?? undefined
  } catch (error) {
    // Never log error.message: the Neon driver echoes the connection string in it.
    console.error('[google/start] connection lookup failed', { name: error instanceof Error ? error.name : typeof error })
    return undefined
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await authorizeSearchConsoleAccount()
  if (!access.ok) return access.response

  // Anything but exactly "analytics" is Search Console, the original behaviour.
  const product: GoogleProduct = req.nextUrl.searchParams.get('scope') === 'analytics' ? 'analytics' : 'search_console'
  // Analytics is dark by default: with the flag off, or on a plan without it, a hand-built
  // link is a plain 404 that asks Google for nothing and sets no cookie.
  if (product === 'analytics'
    && (!isFeatureEnabled('analytics') || !resolveCommercialEntitlement(access.profile.accounts).features.analytics)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[google/start] GOOGLE_TOKEN_ENCRYPTION_KEY is missing or not 32 bytes')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) {
    console.error('[google/start] GOOGLE_OAUTH_CLIENT_ID / _SECRET are not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const requested = req.nextUrl.searchParams.get('return') ?? ''
  const returnPath = RETURN_PATH.test(requested) ? requested : '/en/dashboard/settings'
  const loginHint = product === 'analytics'
    ? await loginHintFor(access.profile.account_id, req.nextUrl.searchParams.get('connection'))
    : undefined
  const { verifier, challenge } = pkcePair()
  const state = randomState()

  const res = NextResponse.redirect(
    buildConsentUrl(cfg, { state, challenge, scopes: scopesFor(product), loginHint }),
    302,
  )
  res.cookies.set(GOOGLE_CONSENT_COOKIE, signConsentState({
    state, verifier, profileId: access.profile.id, accountId: access.profile.account_id, returnPath, product,
  }), {
    httpOnly: true,
    secure: true,
    // Lax, not Strict: the cookie must survive Google's top-level redirect back.
    sameSite: 'lax',
    path: '/api/integrations/google',
    maxAge: Math.floor(CONSENT_TTL_MS / 1000),
  })
  return res
}
