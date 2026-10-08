import { NextRequest, NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { auth } from '@/lib/neon-auth'
import { AUTH_RETURN_TO_HEADER, safeReturnTo } from '@/lib/auth-return-to'

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
// 2. Client-side (the reliable default): LoginForm/AccountUnlockCard point
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
// Values verified against the installed Neon SDK. During the hosted server's
// cookie-name migration, the SDK accepts both the canonical challenge cookie
// and the legacy "challange" spelling. Recognise both before delegating.
const NEON_AUTH_SESSION_VERIFIER_PARAM = 'neon_auth_session_verifier'
const NEON_AUTH_SESSION_CHALLENGE_COOKIES = [
  '__Secure-neon-auth.session_challenge',
  '__Secure-neon-auth.session_challange',
]

const intlMiddleware = createIntlMiddleware(routing)

export function proxy(request: NextRequest) {
  // Embedded SDK sign-in returns to this fixed, unlocalised popup URL. Keep
  // the browser URL/verifier intact until its client notifies the opener; a
  // server exchange here would consume the verifier before that handoff.
  if (request.nextUrl.pathname === '/auth/callback' && request.nextUrl.searchParams.get('neon_popup') === '1') {
    let popupLang: 'en' | 'zh-HK' = 'en'
    let next: string | null = null
    try {
      const callback = new URL(request.nextUrl.searchParams.get('neon_popup_callback') ?? '', request.url)
      const match = callback.pathname.match(/^\/(en|zh-HK)\/auth\/complete$/)
      const publicOrigin = new URL(request.nextUrl.protocol + '//' + (request.headers.get('host') ?? request.nextUrl.host)).origin
      if (callback.origin === publicOrigin && match) {
        popupLang = match[1] as 'en' | 'zh-HK'
        next = callback.searchParams.get('next')
      }
    } catch { /* Invalid callback uses the local default. */ }
    const destination = request.nextUrl.clone()
    destination.pathname = `/${popupLang}/auth/complete`
    const returnTo = safeReturnTo(next, popupLang)
    destination.searchParams.set('next', returnTo)
    const headers = new Headers(request.headers)
    headers.set(AUTH_RETURN_TO_HEADER, returnTo)
    const localized = intlMiddleware(new NextRequest(destination, { headers }))
    localized.headers.delete('x-middleware-next')
    return NextResponse.rewrite(destination, { headers: localized.headers })
  }
  const langMatch = request.nextUrl.pathname.match(/^\/(en|zh-HK)(?:\/|$)/)
  const lang = langMatch ? langMatch[1] : 'en'
  const forwarded = new Headers(request.headers)
  forwarded.set(AUTH_RETURN_TO_HEADER, safeReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`, lang))
  const trustedRequest = new NextRequest(request, { headers: forwarded })
  const popupCompletion = request.nextUrl.searchParams.get('neon_popup') === '1' && /^\/(en|zh-HK)\/auth\/complete$/.test(request.nextUrl.pathname)
  if (
    !popupCompletion &&
    request.nextUrl.searchParams.has(NEON_AUTH_SESSION_VERIFIER_PARAM) &&
    NEON_AUTH_SESSION_CHALLENGE_COOKIES.some(name => request.cookies.has(name))
  ) {
    return auth().middleware({ loginUrl: `/${lang}/auth/login` })(trustedRequest)
  }
  return intlMiddleware(trustedRequest)
}

// `admin` is excluded alongside `api`: the admin surface lives at app/admin/,
// deliberately OUTSIDE the [lang] tree. next-intl's default localePrefix is
// 'always', so any /admin request that reaches the intl middleware is rewritten
// to /en/admin — a path with no page — turning the whole admin area into a
// 307-then-404. Keeping it out of the matcher lets /admin fall straight through
// to app/admin/layout.tsx and its requireAdmin() gate.
//
// The negative lookahead is anchored right after the leading slash, so this
// only excludes TOP-LEVEL /admin. Localised admin pages such as
// /en/admin/authority (app/[lang]/admin/authority/page.tsx) start with the
// locale segment and still go through intl routing.
export const config = {
  matcher: ['/((?!api|admin|_next|.*\\..*).*)'],
}
