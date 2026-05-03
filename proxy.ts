import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

const PROTECTED_PATHS = ['/dashboard', '/admin']
const ADMIN_PATHS = ['/admin']

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // Supabase magic-link / OAuth fallback: if Supabase couldn't use the
  // emailRedirectTo (domain not whitelisted), it redirects to the site URL
  // root with ?code=... appended. The intl middleware then prepends a locale,
  // giving e.g. /zh-HK?code=... — which no page handles. Catch that here and
  // forward to /auth/callback so the code is properly exchanged.
  const authCode = searchParams.get('code')
  const isAuthCallback = pathname.includes('/auth/callback')
  if (authCode && !isAuthCallback) {
    const callbackUrl = request.nextUrl.clone()
    callbackUrl.pathname = '/auth/callback'
    callbackUrl.search = ''
    callbackUrl.searchParams.set('code', authCode)
    const nextParam = searchParams.get('next')
    if (nextParam) callbackUrl.searchParams.set('next', nextParam)
    return NextResponse.redirect(callbackUrl)
  }

  // Strip lang prefix to check path
  const strippedPath = pathname.replace(/^\/(en|zh-HK)/, '') || '/'
  const isProtected = PROTECTED_PATHS.some(p => strippedPath.startsWith(p))
  const isAdmin = ADMIN_PATHS.some(p => strippedPath.startsWith(p))

  if (isProtected) {
    let response = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, { ...options, maxAge: 30 * 24 * 60 * 60 })
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = request.nextUrl.clone()
      const langMatch = pathname.match(/^\/(en|zh-HK)/)
      const lang = langMatch ? langMatch[1] : 'en'
      loginUrl.pathname = `/${lang}/auth/login`
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (isAdmin) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()
      if (!profile?.is_admin) {
        const dashUrl = request.nextUrl.clone()
        const adminLangMatch = pathname.match(/^\/(en|zh-HK)/)
        dashUrl.pathname = `/${adminLangMatch ? adminLangMatch[1] : 'en'}/dashboard`
        return NextResponse.redirect(dashUrl)
      }
    }

    return response
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|auth/callback|_next|.*\\..*).*)'],
}
