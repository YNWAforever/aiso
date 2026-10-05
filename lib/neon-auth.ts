import { createNeonAuth } from '@neondatabase/auth/next/server'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { cache } from 'react'

// Lazy singleton — createNeonAuth is deferred until first use so that
// module evaluation at Next.js build time (when env vars may be absent)
// does not throw.
type NeonAuthInstance = ReturnType<typeof createNeonAuth>

let _instance: NeonAuthInstance | null = null

/**
 * Reads a required Neon Auth variable, or throws naming it.
 *
 * The `!` assertions this replaced turned a missing variable into the SDK's own
 * "Missing required config: cookies.secret", which names a config key but not
 * the environment variable an operator has to set. That mattered more once
 * app/api/auth/[...path]/route.ts stopped constructing the handler at module
 * scope: the failure now surfaces on the first request rather than failing the
 * build, so it has to say what to do about it.
 *
 * `?.trim() ||` rather than `??`: deploy environments substitute '' for a
 * variable that is declared but never given a value, and '' is not a usable
 * secret. Never include the value in the message -- only the name.
 */
function requiredEnv(name: 'NEON_AUTH_BASE_URL' | 'NEON_AUTH_COOKIE_SECRET'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `${name} is not set (or is empty). Neon Auth cannot be constructed without it, ` +
      'so every /api/auth/* request will fail. Set it in this environment.',
    )
  }
  return value
}

export function auth(): NeonAuthInstance {
  if (!_instance) {
    const secret = requiredEnv('NEON_AUTH_COOKIE_SECRET')
    // The SDK enforces this too, but its message does not name the variable.
    // Reporting the length is safe; reporting the value would not be.
    if (secret.length < 32) {
      throw new Error(
        `NEON_AUTH_COOKIE_SECRET must be at least 32 characters; it is ${secret.length}.`,
      )
    }
    _instance = createNeonAuth({
      baseUrl: requiredEnv('NEON_AUTH_BASE_URL'),
      cookies: { secret },
    })
  }
  return _instance
}


type SessionResult = Awaited<ReturnType<NeonAuthInstance['getSession']>>
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Profile reads also run in Server Components, where cookies are read-only.
 * The installed SDK's direct getSession writes upstream Set-Cookie values to
 * next/headers before returning its data. Its official Request/Response
 * handler instead keeps those writes on a detached Response. Read its result
 * first, then persist cookies when this caller is a writable Route or Action.
 * Only Next's specific read-only render guard may prevent that persistence;
 * protected browser navigation renews through the actual Auth route as well.
 * React.cache only deduplicates within the current render request; no session
 * or identity is cached across users. Validation disables server renewal so
 * read-only renders cannot consume renewal before the browser receives it.
 * Verify against Auth rather than reuse a
 * signed cookie cache so revoked/expired sessions cannot keep a page open.
 */
export const getServerSession = cache(async (): Promise<SessionResult> => {
  const response = await auth().handler().GET(
    new Request(new URL('get-session?disableCookieCache=true&disableRefresh=true', `${requiredEnv('NEON_AUTH_BASE_URL').replace(/\/$/, '')}/`), {
      headers: await headers(),
    }),
    { params: Promise.resolve({ path: ['get-session'] }) },
  )
  const body: unknown = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) return null
    throw error
  })
  const outgoingCookies = response.headers.getSetCookie().flatMap(header =>
    new NextResponse(null, { headers: { 'set-cookie': header } }).cookies.getAll().map(cookie => ({
      ...cookie,
      // Next 16's cookie parser compacts falsy values, including empty values
      // and Max-Age=0. Restore both so writable callers truly clear the cookie.
      value: cookie.value ?? '',
      ...(/(?:^|;)\s*max-age=0\s*(?:;|$)/i.test(header) ? { maxAge: 0 } : {}),
    })),
  )
  if (outgoingCookies.length) {
    const store = await cookies()
    for (const cookie of outgoingCookies) {
      try { store.set(cookie) } catch (error) {
        // Next 16 seals render cookies before any mutation; preserve the Auth
        // result, but never hide other cookie/storage or service failures.
        if (error instanceof Error && error.message.startsWith('Cookies can only be modified in a Server Action or Route Handler.')) break
        throw error
      }
    }
  }
  if (response.status === 401) return { data: null, error: null }
  if (!response.ok) {
    return {
      data: null,
      error: {
        status: response.status,
        statusText: response.statusText,
        code: record(body) && typeof body.code === 'string' ? body.code : 'AUTH_SERVICE_ERROR',
        message: record(body) && typeof body.message === 'string' ? body.message
          : record(body) && typeof body.error === 'string' ? body.error : 'Unable to validate the Auth session.',
      },
    }
  }
  if (!record(body) || !record(body.session) || !record(body.user)
    || typeof body.user.id !== 'string' || !body.user.id.trim()
    || typeof body.session.id !== 'string' || !body.session.id.trim()
    || body.session.userId !== body.user.id
    || typeof body.session.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.session.expiresAt))
    || Date.parse(body.session.expiresAt) <= Date.now()) return { data: null, error: null }
  return { data: body as SessionResult['data'], error: null }
})
