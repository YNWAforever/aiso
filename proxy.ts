import { type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

// Auth is enforced in the route-group layouts (app/[lang]/dashboard/layout.tsx →
// requireAuth, app/admin/layout.tsx → requireAdmin), which read the Neon Auth
// session via lib/auth.ts in Server Component context. Middleware only handles
// next-intl locale routing — the Neon Auth SDK's getSession() cannot read cookies
// in middleware, and a redundant middleware auth gate is unnecessary given the
// layouts already protect every /dashboard and /admin route.
const intlMiddleware = createIntlMiddleware(routing)

export function proxy(request: NextRequest) {
  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
