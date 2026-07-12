import { type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { auth } from '@/lib/neon-auth'

// Auth is enforced in the route-group layouts (app/[lang]/dashboard/layout.tsx →
// requireAuth, app/admin/layout.tsx → requireAdmin), which read the Neon Auth
// session via lib/auth.ts in Server Component context. Middleware normally only
// handles next-intl locale routing.
//
// Sign-in completion has TWO paths, and which one applies depends on whether a
// challenge cookie exists on our domain:
//
// 1. Server-side (SDK middleware `exchangeOAuthToken`): requires BOTH the
//    `neon_auth_session_verifier` query param on the return URL AND the
//    challenge cookie set when the sign-in was initiated. Only some flows set
//    that cookie — the magic-link flow does NOT (verified: its send response
//    sets no cookies at all). Delegating a verifier request WITHOUT the
//    challenge cookie to the middleware makes it fall through the failed
//    exchange into its route-protection branch and bounce the user to the
//    login page, killing the sign-in. So we delegate ONLY when both are
//    present.
//
// 2. Client-side (the reliable default): LoginForm/TrialCta point
//    `callbackURL` at /{lang}/auth/complete, whose Neon Auth client exchanges
//    the verifier via `getSession()` (the SDK appends the verifier from
//    window.location to the /api/auth/get-session call). Requests without the
//    challenge cookie fall through to intl routing here so that page can load
//    and complete the exchange.
//
// We deliberately never run the auth middleware on other requests: its default
// SKIP_ROUTES don't match our i18n paths, so running it globally would redirect
// anonymous visitors on public pages to a nonexistent /auth/sign-in.
//
// (Names not exported by @neondatabase/auth — values verified against the
// package dist: NEON_AUTH_SESSION_VERIFIER_PARAM_NAME and
// NEON_AUTH_SESSION_CHALLENGE_COOKIE_NAME, including the SDK's "challange"
// spelling.)
const NEON_AUTH_SESSION_VERIFIER_PARAM = 'neon_auth_session_verifier'
const NEON_AUTH_SESSION_CHALLENGE_COOKIE = '__Secure-neon-auth.session_challange'

const intlMiddleware = createIntlMiddleware(routing)

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has(NEON_AUTH_SESSION_VERIFIER_PARAM) &&
    request.cookies.has(NEON_AUTH_SESSION_CHALLENGE_COOKIE)
  ) {
    const langMatch = request.nextUrl.pathname.match(/^\/(en|zh-HK)/)
    const lang = langMatch ? langMatch[1] : 'en'
    return auth().middleware({ loginUrl: `/${lang}/auth/login` })(request)
  }
  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
