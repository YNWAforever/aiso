import { type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { auth } from '@/lib/neon-auth'

// Auth is enforced in the route-group layouts (app/[lang]/dashboard/layout.tsx →
// requireAuth, app/admin/layout.tsx → requireAdmin), which read the Neon Auth
// session via lib/auth.ts in Server Component context. Middleware normally only
// handles next-intl locale routing.
//
// The ONE exception: completing a sign-in. When the user returns from an
// OAuth/magic-link completion on Neon Auth's hosted domain, the redirect back
// to our domain carries a `neon_auth_session_verifier` query param (plus a
// challenge cookie set on our domain when the sign-in started). The verifier →
// session-cookie exchange is implemented ONLY inside the SDK's middleware
// (`exchangeOAuthToken`), so those requests must be delegated to it — without
// this, users authenticate at Neon but no session cookie is ever set on our
// domain, and every login loops back to the login page.
//
// We deliberately do NOT run the auth middleware on other requests: its default
// SKIP_ROUTES don't match our i18n paths, so running it globally would redirect
// anonymous visitors on public pages to a nonexistent /auth/sign-in. Delegating
// only verifier-carrying requests keeps the exchange working with zero
// route-gating side effects.
//
// (Param name is not exported by @neondatabase/auth — value verified against
// dist/better-auth-helpers: NEON_AUTH_SESSION_VERIFIER_PARAM_NAME.)
const NEON_AUTH_SESSION_VERIFIER_PARAM = 'neon_auth_session_verifier'

const intlMiddleware = createIntlMiddleware(routing)

export function proxy(request: NextRequest) {
  if (request.nextUrl.searchParams.has(NEON_AUTH_SESSION_VERIFIER_PARAM)) {
    const langMatch = request.nextUrl.pathname.match(/^\/(en|zh-HK)/)
    const lang = langMatch ? langMatch[1] : 'en'
    return auth().middleware({ loginUrl: `/${lang}/auth/login` })(request)
  }
  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
