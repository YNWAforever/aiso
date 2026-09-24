import { appOrigin } from '@/lib/app-origin'
import { authorizeSearchConsole } from '@/lib/integrations/search-console/guard'
import {
  bindProperty, listConnections, loadBinding, loadConnectionSecret, loadPanelData, unbindProperty,
} from '@/lib/integrations/search-console/store'
import { listSites, type SiteEntry } from '@/lib/integrations/search-console/client'
import { normalizeBrandDomain, propertyEligibility } from '@/lib/integrations/search-console/binding'
import { deriveOwnerState } from '@/lib/integrations/search-console/state'
import { openToken } from '@/lib/integrations/google/vault'
import { GoogleApiError, googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

// google_connections.id is a `uuid` column (lib/integrations/search-console/store.ts).
// Same idiom as app/api/account/integrations/google/route.ts: without this
// check a malformed id would reach Postgres as 22P02 and the catch below
// would report a caller typo as an outage instead of an honest 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Never log error.message, the error object, or any token — only a fixed tag plus the error's name. */
function logFailure(tag: string, error: unknown): void {
  console.error(`[search-console/binding] ${tag}`, { name: error instanceof Error ? error.name : typeof error })
}

/** Every misconfigured Google failure is an operator problem, never the owner's — log it, unlike the other kinds. */
function logIfMisconfigured(error: unknown): void {
  if (error instanceof GoogleApiError && error.kind === 'misconfigured') {
    console.error('[search-console/binding] google misconfigured', { kind: error.kind, status: error.status, code: error.code })
  }
}

/** Null when the connection is not this account's. Throws GoogleApiError otherwise. */
async function sitesFor(accountId: string, connectionId: string): Promise<SiteEntry[] | null> {
  const secret = await loadConnectionSecret(accountId, connectionId)
  if (!secret) return null
  if (secret.status !== 'active' || !secret.sealed) throw new GoogleApiError('revoked', 0)
  const cfg = googleOAuthConfig(process.env, appOrigin())
  // Distinct from the 'unavailable' Google itself can return: this is our own
  // deploy missing GOOGLE_OAUTH_CLIENT_ID/_SECRET, an operator problem, so it
  // must log — see logIfMisconfigured.
  if (!cfg) throw new GoogleApiError('misconfigured', 0, 'oauth_config_missing')
  return listSites(await refreshAccessToken(cfg, openToken(secret.sealed, { accountId })))
}

type PropertyResult = {
  connectionId: string
  googleEmail: string | null
  error: string | null
  sites: Array<SiteEntry & { verdict: ReturnType<typeof propertyEligibility> }>
}

/**
 * Fans out one Google call per active connection. Only called when the
 * caller actually asked for properties (spec: GET must not call Google on
 * every dashboard load) — the dashboard's default view never needs this list,
 * only the picker the owner opens to bind or rebind a property.
 */
async function listProperties(accountId: string, brandDomain: string | null): Promise<PropertyResult[]> {
  const connections = await listConnections(accountId)
  return Promise.all(connections.filter(c => c.status === 'active').map(async (c): Promise<PropertyResult> => {
    try {
      const sites = (await sitesFor(accountId, c.id)) ?? []
      return {
        connectionId: c.id, googleEmail: c.googleEmail, error: null,
        sites: sites.map(s => ({ ...s, verdict: propertyEligibility(s.siteUrl, s.permissionLevel, brandDomain) })),
      }
    } catch (error) {
      // One connection's Google failure must never fail the whole GET — each
      // connection carries its own error kind instead.
      logIfMisconfigured(error)
      if (!(error instanceof GoogleApiError)) logFailure('sitesFor failed', error)
      return {
        connectionId: c.id, googleEmail: c.googleEmail, sites: [],
        error: error instanceof GoogleApiError ? error.kind : 'unavailable',
      }
    }
  }))
}

export async function GET(req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response
  const accountId = access.profile.account_id
  const wantsProperties = new URL(req.url).searchParams.get('properties') === '1'

  try {
    const [binding, panel] = await Promise.all([
      loadBinding(accountId, clientId),
      loadPanelData(accountId, clientId),
    ])
    const properties = wantsProperties ? await listProperties(accountId, access.client.domain) : []

    const state = deriveOwnerState({
      bound: binding !== null,
      // The guard has already refused an unentitled caller.
      entitled: true,
      connectionStatus: binding?.connectionStatus ?? null,
      domainMatches: binding
        ? normalizeBrandDomain(binding.currentDomain) === normalizeBrandDomain(binding.boundDomain)
        : true,
      latest: panel.latest,
      lastGoodDataThrough: panel.lastGoodDataThrough,
    })
    return Response.json({ state, binding, panel, properties })
  } catch (error) {
    logFailure('lookup failed', error)
    return Response.json({ error: 'Lookup failed' }, { status: 503 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null) as { connectionId?: unknown; siteUrl?: unknown } | null
  if (!body || typeof body.connectionId !== 'string' || typeof body.siteUrl !== 'string') {
    return Response.json({ error: 'connectionId and siteUrl required' }, { status: 400 })
  }
  if (!UUID_RE.test(body.connectionId)) {
    return Response.json({ error: 'Invalid connectionId' }, { status: 400 })
  }
  const accountId = access.profile.account_id

  let sites: SiteEntry[] | null
  try {
    sites = await sitesFor(accountId, body.connectionId)
  } catch (error) {
    logIfMisconfigured(error)
    if (!(error instanceof GoogleApiError)) logFailure('sitesFor failed', error)
    const kind = error instanceof GoogleApiError ? error.kind : 'unavailable'
    return Response.json({ error: 'GOOGLE', reason: kind }, { status: kind === 'revoked' ? 409 : 503 })
  }
  if (!sites) return Response.json({ error: 'Not found' }, { status: 404 })

  // Never trust a permission level from the body: take Google's.
  const site = sites.find(s => s.siteUrl === body.siteUrl)
  if (!site) return Response.json({ error: 'INELIGIBLE', reason: 'not_visible' }, { status: 422 })
  const verdict = propertyEligibility(site.siteUrl, site.permissionLevel, access.client.domain)
  if (!verdict.eligible) return Response.json({ error: 'INELIGIBLE', reason: verdict.reason }, { status: 422 })

  try {
    const bound = await bindProperty({
      accountId, clientId, connectionId: body.connectionId, siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel,
      boundDomain: normalizeBrandDomain(access.client.domain)!,
      profileId: access.profile.id,
    })
    if (!bound) return Response.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    logFailure('bindProperty failed', error)
    return Response.json({ error: 'Bind failed' }, { status: 503 })
  }
  return Response.json({ bound: true })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeSearchConsole(clientId)
  if (!access.ok) return access.response
  try {
    const removed = await unbindProperty(access.profile.account_id, clientId)
    return removed ? Response.json({ unbound: true }) : Response.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    logFailure('unbindProperty failed', error)
    return Response.json({ error: 'Unbind failed' }, { status: 503 })
  }
}
