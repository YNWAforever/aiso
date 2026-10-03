import { db } from '@/lib/db'
import { getProfile } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { authLocale,safeReturnTo } from '@/lib/auth-return-to'
import { redactSecrets } from '@/lib/security/redact-secrets'
import { cookies } from 'next/headers'
import { CLAIM_INTENT_COOKIE, authorizedScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ scan?: string | string[] }>
}) {
  const { lang: requestedLang } = await params
  const lang = authLocale(requestedLang)
  const { scan } = await searchParams
  const scanId = typeof scan === 'string' && scan.trim() ? scan : undefined
  const profile = await getProfile()
  if (!profile) {
    const destination=safeReturnTo(`/${lang}/onboarding${scanId?`?scan=${encodeURIComponent(scanId)}`:''}`,lang)
    redirect(`/${lang}/auth/login?next=${encodeURIComponent(destination)}`)
  }

  // Pre-fill from scan if provided
  let initialBrand = ''
  let initialDomain = ''
  let initialIndustry = ''
  let initialRegion = ''

  if (scanId) {
    try {
      const sql = db()
      const jar = await cookies()
      const validIntent = !!authorizedScanClaimIntent(jar.get(CLAIM_INTENT_COOKIE)?.value, scanId)
      const rows = await sql`
        select domain, industry, region from scans where id = ${scanId}
          and (account_id = ${profile.account_id} or (account_id is null and ${validIntent})) limit 1
      `
      const data = rows[0] as { domain: string | null; industry: string | null; region: string | null } | undefined
      if (data) {
        initialDomain = data.domain ?? ''
        // Guess brand from domain: strip TLD and capitalise
        const parts = data.domain?.split('.') ?? []
        if (parts.length >= 2) {
          const name = parts[parts.length - 2] ?? ''
          initialBrand = name.charAt(0).toUpperCase() + name.slice(1)
        }
        initialIndustry = data.industry ?? ''
        initialRegion = data.region ?? ''
      }
    } catch (err) {
      // Pre-fill is a convenience, not the page's core function — a failed
      // lookup must not block onboarding. Degrade to the same blank fields
      // used when no scanId is supplied at all.
      console.error('[onboarding] scan pre-fill lookup failed:', redactSecrets((err as Error)?.message ?? String(err)))
    }
  }

  return (
    <OnboardingWizard
      lang={lang}
      accountId={profile.account_id}
      scanId={scanId}
      initialBrand={initialBrand}
      initialDomain={initialDomain}
      initialIndustry={initialIndustry}
      initialRegion={initialRegion}
    />
  )
}
