import { cookies } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { loadOwnedPortfolio } from '@/lib/workspace/load-owned-portfolio'
import { buildPortfolio } from '@/lib/view-models/portfolio'
import { buildActivationProgress } from '@/lib/view-models/activation-progress'
import { readActivation } from '@/lib/telemetry/activation'
import { CLAIM_INTENT_COOKIE, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { PortfolioView } from '@/components/dashboard/PortfolioView'
import { AddBrandWizard } from '@/components/dashboard/AddBrandWizard'

/**
 * The scan this visitor ran before signing up, if the signed intent is still
 * valid. Read, never consumed: single-use consumption belongs to the claim
 * itself, and spending it to render a link would leave the link unable to claim.
 */
async function pendingClaimScanId(): Promise<string | null> {
  const token = (await cookies()).get(CLAIM_INTENT_COOKIE)?.value
  if (!token) return null
  return verifyScanClaimIntent(token)?.scanId ?? null
}

export default async function DashboardPage({params}: {params:Promise<{lang:string}>}) {
  const {lang} = await params
  const profile = await requireAuth(lang)
  const t = await getTranslations({locale:lang,namespace:'portfolio'})
  let owned
  try {
    owned = await loadOwnedPortfolio({profile})
  } catch {
    return <main className="px-6 py-12"><h1 className="text-xl font-bold text-foreground">{t('loadErrorTitle')}</h1><p className="mt-3 text-sm text-muted-foreground">{t('loadErrorBody')}</p></main>
  }
  const portfolio = buildPortfolio(owned)
  // Activation is secondary content: a failed read reports itself as unavailable
  // rather than taking the portfolio down. `null` here means the read failed and
  // nothing else — an account that has genuinely done nothing still reports 0/6.
  let activation = null
  try {
    activation = await readActivation(profile.account_id)
  } catch {
    activation = null
  }
  const creationControl = portfolio.capacity.state === 'known' && portfolio.capacity.canCreate === true ? <AddBrandWizard lang={lang}/> : null
  return <PortfolioView portfolio={portfolio} lang={lang} creationControl={creationControl}
    activation={buildActivationProgress(activation)} firstRunScanId={await pendingClaimScanId()}/>
}
