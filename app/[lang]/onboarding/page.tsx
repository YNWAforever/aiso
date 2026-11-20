import { db } from '@/lib/db'
import { getProfile } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { authLocale, safeReturnTo } from '@/lib/auth-return-to'
import { redactSecrets } from '@/lib/security/redact-secrets'
import { cookies } from 'next/headers'
import { CLAIM_INTENT_COOKIE, authorizedScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { parseOnboardingInput, UUID, type OnboardingInput } from '@/lib/onboarding/schema'
import { scanReportHref } from '@/lib/result/links'

type Prefill = Record<string, unknown> & {
  domain: string | null
  industry: string | null
  region: string | null
  client_id: string | null
  owned_client_id: string | null
  pending_setup: Record<string, unknown> | null
}

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
  const scanId = typeof scan === 'string' && UUID.test(scan) ? scan : undefined
  const profile = await getProfile()
  if (!profile) {
    const destination = safeReturnTo(`/${lang}/onboarding${scanId ? `?scan=${encodeURIComponent(scanId)}` : ''}`, lang)
    redirect(`/${lang}/auth/login?next=${encodeURIComponent(destination)}`)
  }

  let prefill: Prefill | undefined
  let savedSetup: OnboardingInput | undefined
  let scanProblem: 'unavailable' | 'lookup-error' | undefined
  if (scanId) {
    try {
      const jar = await cookies()
      const validIntent = !!authorizedScanClaimIntent(jar.get(CLAIM_INTENT_COOKIE)?.value, scanId)
      const rows = await db()`
        select s.domain, s.industry, s.region, s.client_id, c.id as owned_client_id, p.draft as pending_setup
        from scans s
        left join clients c on c.id = s.client_id and c.account_id = ${profile.account_id}
        left join onboarding_progress p on p.account_id = c.account_id and p.client_id = c.id
          and p.scan_id = s.id and p.prompt_status <> 'ready'
        where s.id = ${scanId} and (s.account_id = ${profile.account_id}
          or (s.account_id is null and s.client_id is null and ${validIntent})) limit 1
      `
      prefill = rows[0] as Prefill | undefined
      if (!prefill || (prefill.client_id && !prefill.owned_client_id)) scanProblem = 'unavailable'
    } catch (error) {
      scanProblem = 'lookup-error'
      console.error('[onboarding] scan pre-fill lookup failed:', redactSecrets(error instanceof Error ? error.message : String(error)))
    }
    if (prefill?.owned_client_id) {
      if (prefill.pending_setup) {
        const saved = prefill.pending_setup
        try {
          savedSetup = parseOnboardingInput({ ...saved, clientId: prefill.owned_client_id, language: saved.language ?? undefined })
        } catch { /* The linked report is still available for older setup records. */ }
      }
      if (!savedSetup) redirect(scanReportHref(lang, prefill.owned_client_id, scanId))
    }
  } else if (Array.isArray(scan) || scan?.trim()) {
    scanProblem = 'unavailable'
  }

  return (
    <OnboardingWizard
      lang={lang}
      accountId={profile.account_id}
      scanId={scanId}
      scanProblem={scanProblem}
      savedSetup={savedSetup}
      initialBrand=""
      initialDomain={scanProblem ? '' : prefill?.domain ?? ''}
      initialIndustry={scanProblem ? '' : prefill?.industry ?? ''}
      initialRegion={scanProblem ? '' : prefill?.region ?? ''}
    />
  )
}
