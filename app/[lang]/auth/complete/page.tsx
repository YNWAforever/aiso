import { AuthComplete } from '@/components/auth/AuthComplete'

// Client-side sign-in completion target. LoginForm and AccountUnlockCard point their
// Neon Auth `callbackURL` here; the client component exchanges the
// `neon_auth_session_verifier` URL param for a session cookie, then forwards
// to `next`.
export default async function AuthCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ next?: string }>
}) {
  const { lang } = await params
  const { next } = await searchParams
  return <AuthComplete lang={lang} next={next} />
}
