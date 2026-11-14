import { cookies } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { loadOwnedPortfolio } from '@/lib/workspace/load-owned-portfolio'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { buildPortfolio } from '@/lib/view-models/portfolio'
import { buildWorkspaceHome } from '@/lib/view-models/workspace-home'
import type { MonthlyReportHomeEntry } from '@/lib/view-models/workspace-home'
import { currentMonthReport } from '@/lib/monthly-report/report-entry'
import { listMonthlyReports } from '@/lib/monthly-report/store'
import { buildActivationProgress } from '@/lib/view-models/activation-progress'
import { readActivation } from '@/lib/telemetry/activation'
import { CLAIM_INTENT_COOKIE, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { PortfolioView } from '@/components/dashboard/PortfolioView'
import { AddBrandWizard } from '@/components/dashboard/AddBrandWizard'
import { BrandToday } from '@/components/dashboard/today/BrandToday'
import { isConversationStudioEnabled, isSmeCopilotUiEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'

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
  // SME copilot IA: an owner with one brand lands on that brand's Today instead
  // of a portfolio wall of one card. Two or more brands keep the portfolio.
  // Loads happen before any JSX so a failed read renders an error, never a
  // half-built tree (react-hooks/error-boundaries).
  if (isSmeCopilotUiEnabled() && portfolio.clients.length === 1) {
    const client = portfolio.clients[0]!
    const entitlement = resolveCommercialEntitlement(profile.accounts)
    const todayT = await getTranslations({ locale: lang, namespace: 'today' })
    let workspace: ReturnType<typeof buildWorkspaceHome> | null = null
    try {
      const owned = await loadOwnedWorkspace({ clientId: client.id, profile, scanId: undefined, withTaskCount: true, withSavedWork: true })
      if (owned) {
        let monthlyReport: MonthlyReportHomeEntry | null = null
        if (entitlement.features.client_reports_online) {
          try {
            const current = currentMonthReport(await listMonthlyReports(profile.account_id, client.id))
            monthlyReport = current ? { month: current.month, status: current.status, versionNumber: current.versionNumber } : null
          } catch { monthlyReport = null }
        }
        workspace = buildWorkspaceHome(owned, monthlyReport)
      }
    } catch {
      return <main className="px-6 py-12">
        <h1 className="text-xl font-bold text-foreground">{todayT('loadError')}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{todayT('loadErrorBody')}</p>
      </main>
    }
    if (workspace) return <BrandToday
      workspace={workspace}
      lang={lang}
      chatEnabled={isConversationStudioEnabled(client.id)}
      clientReportsOnline={entitlement.features.client_reports_online}
      accountHome
    />
  }
  return <PortfolioView portfolio={portfolio} lang={lang} creationControl={creationControl}
    activation={buildActivationProgress(activation)} firstRunScanId={await pendingClaimScanId()}/>
}
