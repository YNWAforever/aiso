import { supabase } from '@/lib/supabase'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ scan?: string }>
}) {
  const { lang } = await params
  const { scan: scanId } = await searchParams

  // Pre-fill from scan if provided
  let initialBrand = ''
  let initialDomain = ''
  let initialIndustry = ''
  let initialRegion = ''

  if (scanId) {
    const { data } = await supabase
      .from('scans')
      .select('domain, industry, region')
      .eq('id', scanId)
      .single()
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
