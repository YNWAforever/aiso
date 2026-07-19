import { GoogleAuthStart } from '@/components/auth/GoogleAuthStart'
import { normalizeAuthNext } from '@/lib/auth-navigation'

export default async function GoogleAuthStartPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { lang } = await params
  const { next: rawNext } = await searchParams
  const requestedNext = Array.isArray(rawNext) ? rawNext[0] : rawNext
  const next = normalizeAuthNext(lang, requestedNext)

  return <GoogleAuthStart lang={lang} next={next} />
}
