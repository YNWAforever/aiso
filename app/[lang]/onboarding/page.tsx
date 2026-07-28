import { db } from '@/lib/db'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ scan?: string | string[] }>
}) {
  const { lang } = await params
  const { scan } = await searchParams
  const scanId = typeof scan === 'string' && scan.trim() ? scan : undefined

  // Pre-fill from scan if provided
  let initialBrand = ''
  let initialDomain = ''
  let initialIndustry = ''
  let initialRegion = ''

  if (scanId) {
    try {
      const sql = db()
      const rows = await sql`
        select domain, industry, region from scans where id = ${scanId} limit 1
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
      console.error('[onboarding] scan pre-fill lookup failed:', (err as Error)?.message ?? String(err))
    }
  }

  return (
    <OnboardingWizard
      lang={lang}
      scanId={scanId}
      initialBrand={initialBrand}
      initialDomain={initialDomain}
      initialIndustry={initialIndustry}
      initialRegion={initialRegion}
    />
  )
}
