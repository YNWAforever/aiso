import { auth } from '@/lib/neon-auth'

/**
 * The Neon Auth catch-all, deliberately built lazily.
 *
 * This was `export const { GET, POST, ... } = auth().handler()`, which runs
 * createNeonAuth during MODULE EVALUATION. Next evaluates every route module
 * while "Collecting page data", so a build in an environment that has not been
 * given NEON_AUTH_COOKIE_SECRET failed outright with "Failed to collect page
 * data for /api/auth/[...path]" -- observed on a Vercel preview deploy
 * 2026-09-01. `export const dynamic = 'force-dynamic'` does not exempt a route
 * from that evaluation; only not calling auth() at module scope does. That is
 * exactly CLAUDE.md's standing rule, which this file was the one violation of.
 *
 * The handler is still built once and reused -- lib/neon-auth.ts holds the
 * singleton -- just on the first request rather than at import. Signatures are
 * the SDK's own, unchanged.
 */
type AuthHandlers = ReturnType<ReturnType<typeof auth>['handler']>
type AuthRouteContext = { params: Promise<{ path: string[] }> }

let handlers: AuthHandlers | null = null

function route(method: keyof AuthHandlers) {
  return async (request: Request, context: AuthRouteContext): Promise<Response> => {
    if (method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.has('neon_auth_session_verifier')) {
        const { path } = await context.params
        if (path.length === 1 && path[0] === 'get-session') {
          // SDK 0.4.2-beta checks the old cookie cache before the verifier.
          // Complete the new sign-in upstream before accepting its identity.
          url.searchParams.set('disableCookieCache', 'true')
          request = new Request(url, request)
        }
      }
    }
    handlers ??= auth().handler()
    const response = await handlers[method](request, context)
    // Node fetch decodes upstream gzip/br before the SDK returns this body,
    // but SDK 0.4.2-beta retains the old transport headers. Forwarding them
    // makes the browser decode JSON again, even after the cookie was stored.
    const headers = new Headers(response.headers)
    // Keep session JSON out of HTTP caches; the SDK cookie cache is separate.
    headers.set('cache-control', 'private, no-store')
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) {
      headers.delete(name)
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

export const GET = route('GET')
export const POST = route('POST')
export const PUT = route('PUT')
export const DELETE = route('DELETE')
export const PATCH = route('PATCH')
