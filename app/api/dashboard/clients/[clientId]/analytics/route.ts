import { appOrigin } from '@/lib/app-origin'
import { authorizeAnalytics } from '@/lib/integrations/analytics/guard'
import {
  bindStream, loadAnalyticsBinding, loadAnalyticsPanel, unbindStream, updateKeyEvents,
} from '@/lib/integrations/analytics/store'
import {
  AnalyticsApiError, listKeyEvents, listProperties, listWebStreams, type AnalyticsFailure,
} from '@/lib/integrations/analytics/client'
import {
  STREAM_HOST_MAX, streamEligibility, streamStillMatches, type StreamVerdict, type WebStream,
} from '@/lib/integrations/analytics/binding'
import { deriveAnalyticsOwnerState } from '@/lib/integrations/analytics/state'
import { listConnections, loadConnectionSecret, markConnection } from '@/lib/integrations/search-console/store'
import { acquireAccessToken, type TokenDeps, type TokenFailure } from '@/lib/integrations/google/access'
import { openToken } from '@/lib/integrations/google/vault'
import { GoogleApiError, googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'
import { ANALYTICS_SCOPE, hasScope } from '@/lib/integrations/google/scopes'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ clientId: string }> }

// google_connections.id is a `uuid` column. Without this check a malformed id
// would reach Postgres as 22P02 and the catch below would report a caller typo
// as an outage instead of an honest 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// GA4 property and stream ids are numeric. They are interpolated into Google
// URLs, so anything but digits is refused before a request is made.
const GA_ID_RE = /^\d{1,20}$/
const MAX_EVENTS = 20
const EVENT_NAME_MAX = 40

type Reason = AnalyticsFailure | TokenFailure

/** Never log error.message, the error object, or any token: only a fixed tag plus the error's name. */
function logFailure(tag: string, error: unknown): void {
  console.error(`[analytics/binding] ${tag}`, { name: error instanceof Error ? error.name : typeof error })
}

/** A misconfigured deploy is an operator problem, never the owner's: log it, unlike the other kinds. */
function logIfMisconfigured(error: unknown): void {
  if ((error instanceof GoogleApiError || error instanceof AnalyticsApiError) && error.kind === 'misconfigured') {
    console.error('[analytics/binding] google misconfigured', { kind: error.kind, status: error.status, code: error.code })
  }
}

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })
const lookupFailed = () => Response.json({ error: 'Lookup failed' }, { status: 503 })
const badRequest = (error: string) => Response.json({ error }, { status: 400 })
const ineligible = (reason: string) => Response.json({ error: 'INELIGIBLE', reason }, { status: 422 })

/**
 * The owner can act on `revoked` (reconnect) and `scope_missing` (grant), so those
 * are 409 like Search Console's revoked; a denial by Google itself is a 502; the
 * rest are transient or ours, 503.
 */
function googleFailure(reason: Reason): Response {
  const status = reason === 'revoked' || reason === 'scope_missing' ? 409 : reason === 'access_lost' ? 502 : 503
  return Response.json({ error: 'GOOGLE', reason }, { status })
}

/** The failure a Google-facing call raised, or null when it was not Google's (a database error, say). */
function googleReason(error: unknown): Reason | null {
  if (error instanceof AnalyticsApiError) {
    logIfMisconfigured(error)
    return error.kind
  }
  if (error instanceof GoogleApiError) {
    // acquireAccessToken rethrows only `forbidden` from a refresh: the grant is intact but Google refuses this user.
    return error.kind === 'forbidden' ? 'access_lost' : 'unavailable'
  }
  return null
}

type Acquired =
  | { ok: true; accessToken: string }
  /** `reason` is absent for a 404: the connection is not this account's. */
  | { ok: false; response: Response; reason?: Reason }

/**
 * A short-lived access token for the account's own connection, or the response
 * to send instead. Throws only for what is not Google's doing (database, vault),
 * which the caller turns into a 503.
 */
async function acquire(accountId: string, connectionId: string, clientId: string): Promise<Acquired> {
  let missing = false
  const cfg = googleOAuthConfig(process.env, appOrigin())
  const deps: TokenDeps = {
    loadSecret: async (a, c) => {
      const secret = await loadConnectionSecret(a, c)
      if (!secret) missing = true
      return secret
    },
    open: (sealed, a) => openToken(sealed, { accountId: a }),
    // Our own deploy missing GOOGLE_OAUTH_CLIENT_ID/_SECRET is an operator problem, classified as config_error.
    refresh: async refreshToken => {
      if (!cfg) throw new GoogleApiError('misconfigured', 0, 'oauth_config_missing')
      return refreshAccessToken(cfg, refreshToken)
    },
    markConnection,
  }
  let token
  try {
    token = await acquireAccessToken(deps, {
      accountId, connectionId, clientId, outOfTime: () => false, logTag: '[analytics/binding]',
    })
  } catch (error) {
    const reason = googleReason(error)
    if (reason) return { ok: false, response: googleFailure(reason), reason }
    throw error
  }
  // A missing row is another account's connection (or none): 404, not "revoked".
  if (missing) return { ok: false, response: notFound() }
  if (!token.ok) return { ok: false, response: googleFailure(token.outcome), reason: token.outcome }
  // The consent that granted Search Console alone carries no analytics grant.
  if (!hasScope(token.scopes, ANALYTICS_SCOPE)) return { ok: false, response: googleFailure('scope_missing'), reason: 'scope_missing' }
  return { ok: true, accessToken: token.accessToken }
}

/** streamEligibility plus the length the stored column allows, so the DB CHECK is never what refuses a host. */
function verdictFor(defaultUri: string, brandDomain: string | null): StreamVerdict {
  const verdict = streamEligibility(defaultUri, brandDomain)
  if (verdict.eligible && verdict.host.length > STREAM_HOST_MAX) return { eligible: false, reason: 'invalid_uri' }
  return verdict
}

type PropertyResult = {
  connectionId: string
  items: Array<{ propertyId: string; displayName: string }>
  error: Reason | null
}

/**
 * One Google call per connection that can make it. A connection that is not
 * active or lacks the analytics scope is reported without calling Google, and one
 * connection's failure never fails the others.
 */
async function propertiesFor(
  accountId: string,
  clientId: string,
  connections: Awaited<ReturnType<typeof listConnections>>,
): Promise<PropertyResult[]> {
  return Promise.all(connections.map(async (c): Promise<PropertyResult> => {
    if (c.status !== 'active') return { connectionId: c.id, items: [], error: 'revoked' }
    if (!hasScope(c.scopes, ANALYTICS_SCOPE)) return { connectionId: c.id, items: [], error: 'scope_missing' }
    try {
      const acquired = await acquire(accountId, c.id, clientId)
      if (!acquired.ok) {
        return { connectionId: c.id, items: [], error: acquired.reason ?? 'unavailable' }
      }
      return { connectionId: c.id, items: await listProperties(acquired.accessToken), error: null }
    } catch (error) {
      const reason = googleReason(error)
      if (!reason) logFailure('properties failed', error)
      return { connectionId: c.id, items: [], error: reason ?? 'unavailable' }
    }
  }))
}

export async function GET(req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeAnalytics(clientId)
  if (!access.ok) return access.response
  const accountId = access.profile.account_id
  const query = new URL(req.url).searchParams
  const wantsProperties = query.get('properties') === '1'
  const pickProperty = query.get('property')
  const pickConnection = query.get('connection')

  // Validated before any store or Google call. The picker needs both or neither.
  const wantsPicker = pickProperty !== null || pickConnection !== null
  if (wantsPicker && (pickProperty === null || !GA_ID_RE.test(pickProperty) || pickConnection === null || !UUID_RE.test(pickConnection))) {
    return badRequest('property (digits) and connection (uuid) required together')
  }

  try {
    const [binding, connections] = await Promise.all([
      loadAnalyticsBinding(accountId, clientId),
      listConnections(accountId),
    ])
    const panel = binding
      ? await loadAnalyticsPanel(accountId, clientId, binding.keyEvents, binding.boundAt)
      : null

    const boundConnection = binding ? connections.find(c => c.id === binding.connectionId) : undefined
    const state = deriveAnalyticsOwnerState({
      bound: binding !== null,
      // The guard has already refused an unentitled caller.
      entitled: true,
      connectionStatus: binding?.connectionStatus ?? null,
      hasAnalyticsScope: boundConnection ? hasScope(boundConnection.scopes, ANALYTICS_SCOPE) : false,
      // The same predicate the sync skips on, so the owner is told to rebind exactly when the sync has stopped.
      domainMatches: binding ? streamStillMatches(binding.streamHost, access.client.domain) : true,
      boundAt: binding?.boundAt ?? null,
      eventsChosenAt: binding?.eventsChosenAt ?? null,
      latest: panel?.latest ?? null,
      lastGoodDataThrough: panel?.lastGoodDataThrough ?? null,
    })

    const properties = wantsProperties ? await propertiesFor(accountId, clientId, connections) : []

    let picker: { streams: Array<WebStream & { verdict: StreamVerdict }>; keyEvents: string[] } | null = null
    if (wantsPicker) {
      const acquired = await acquire(accountId, pickConnection!, clientId)
      if (!acquired.ok) return acquired.response
      try {
        const [streams, keyEvents] = await Promise.all([
          listWebStreams(acquired.accessToken, pickProperty!),
          listKeyEvents(acquired.accessToken, pickProperty!),
        ])
        picker = { streams: streams.map(s => ({ ...s, verdict: verdictFor(s.defaultUri, access.client.domain) })), keyEvents }
      } catch (error) {
        const reason = googleReason(error)
        if (!reason) throw error
        return googleFailure(reason)
      }
    }

    return Response.json({
      state,
      binding,
      panel,
      connections: connections.map(c => ({ id: c.id, email: c.googleEmail, hasAnalytics: hasScope(c.scopes, ANALYTICS_SCOPE) })),
      properties,
      picker,
    })
  } catch (error) {
    logFailure('lookup failed', error)
    return lookupFailed()
  }
}

type EventsResult = { ok: true; keyEvents: string[] } | { ok: false }

/** 1–20 distinct names of 1–40 characters, compared exactly: GA4 event names are case-sensitive. */
function parseKeyEvents(value: unknown): EventsResult {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVENTS) return { ok: false }
  if (!value.every(e => typeof e === 'string' && e.length >= 1 && e.length <= EVENT_NAME_MAX)) return { ok: false }
  if (new Set(value).size !== value.length) return { ok: false }
  return { ok: true, keyEvents: value as string[] }
}

type BindBody = { mode: 'bind'; connectionId: string; propertyId: string; streamId: string; keyEvents: string[] }
type EventsBody = { mode: 'events'; keyEvents: string[] }

/** Validates the whole body shape before anything is looked up. */
function parseBody(raw: unknown): BindBody | EventsBody | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  const events = parseKeyEvents(b.keyEvents)
  if (!events.ok) return null
  const supplied = [b.connectionId, b.propertyId, b.streamId].filter(v => v !== undefined)
  if (supplied.length === 0) return { mode: 'events', keyEvents: events.keyEvents }
  if (supplied.length !== 3) return null
  const { connectionId, propertyId, streamId } = b
  if (typeof connectionId !== 'string' || !UUID_RE.test(connectionId)) return null
  if (typeof propertyId !== 'string' || !GA_ID_RE.test(propertyId)) return null
  if (typeof streamId !== 'string' || !GA_ID_RE.test(streamId)) return null
  return { mode: 'bind', connectionId, propertyId, streamId, keyEvents: events.keyEvents }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeAnalytics(clientId)
  if (!access.ok) return access.response

  const raw = await req.json().catch(() => null) as unknown
  const body = parseBody(raw)
  if (!body) return badRequest('connectionId, propertyId, streamId and 1-20 distinct keyEvents required')
  const accountId = access.profile.account_id

  try {
    let connectionId: string
    let propertyId: string
    if (body.mode === 'bind') {
      connectionId = body.connectionId
      propertyId = body.propertyId
    } else {
      // Events-only: the connection and property are the stored ones, never the request's.
      const existing = await loadAnalyticsBinding(accountId, clientId)
      if (!existing) return notFound()
      connectionId = existing.connectionId
      propertyId = existing.propertyId
    }

    const acquired = await acquire(accountId, connectionId, clientId)
    if (!acquired.ok) return acquired.response

    let stream: WebStream | undefined
    let currentEvents: string[]
    try {
      if (body.mode === 'bind') {
        const [streams, events] = await Promise.all([
          listWebStreams(acquired.accessToken, propertyId),
          listKeyEvents(acquired.accessToken, propertyId),
        ])
        stream = streams.find(s => s.streamId === body.streamId)
        currentEvents = events
      } else {
        currentEvents = await listKeyEvents(acquired.accessToken, propertyId)
      }
    } catch (error) {
      const reason = googleReason(error)
      if (!reason) throw error
      return googleFailure(reason)
    }

    // Never trust a host or a stream's eligibility from the body: take Google's.
    let streamHost = ''
    if (body.mode === 'bind') {
      // An app stream is not in the web-stream list either, so it is refused here.
      if (!stream) return ineligible('not_visible')
      const verdict = verdictFor(stream.defaultUri, access.client.domain)
      if (!verdict.eligible) return ineligible(verdict.reason)
      streamHost = verdict.host
    }

    const live = new Set(currentEvents)
    if (!body.keyEvents.every(e => live.has(e))) return ineligible('not_key_event')

    if (body.mode === 'events') {
      const updated = await updateKeyEvents(accountId, clientId, body.keyEvents)
      return updated ? Response.json({ updated: true }) : notFound()
    }
    const result = await bindStream({
      accountId, clientId, connectionId, propertyId, streamId: body.streamId, streamHost, keyEvents: body.keyEvents,
    })
    return result === 'bound' ? Response.json({ bound: true }) : notFound()
  } catch (error) {
    logFailure('write failed', error)
    return Response.json({ error: 'Bind failed' }, { status: 503 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { clientId } = await params
  const access = await authorizeAnalytics(clientId)
  if (!access.ok) return access.response
  try {
    const removed = await unbindStream(access.profile.account_id, clientId)
    return removed ? Response.json({ unbound: true }) : notFound()
  } catch (error) {
    logFailure('unbindStream failed', error)
    return Response.json({ error: 'Unbind failed' }, { status: 503 })
  }
}
