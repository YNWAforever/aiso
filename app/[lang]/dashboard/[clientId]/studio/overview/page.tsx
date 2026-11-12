import { redirect } from 'next/navigation'
import { StudioOverviewView } from '@/components/dashboard/StudioOverviewViews'
import { isSmeCopilotUiEnabled } from '@/lib/flags'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { loadStudioOpportunities } from '@/lib/conversation-studio/opportunities'
import { loadStudioOverview } from '@/lib/conversation-studio/overview'

export default async function StudioOverviewPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile, brand, accountId, staff } = await requireStudioBrand(lang, clientId, { allowStaff: true })
  // Approved SME IA: the old Studio "Overview" is the brand Today now. The staff
  // view keeps this page (it has no dashboard of its own to land on).
  if (!staff && isSmeCopilotUiEnabled()) redirect(`/${lang}/dashboard/${encodeURIComponent(clientId)}`)
  // Saved data only: no model, provider or Google call on this page. A staff view
  // reads the brand's own account; opportunities and Search Console resolve through
  // the viewer's session, so they read as unavailable there rather than as empty.
  const opportunities = staff ? null : await loadStudioOpportunities(clientId, lang).catch(() => null)
  const overview = await loadStudioOverview(staff ? { account_id: accountId } : profile, clientId, opportunities, { staff })
  return <StudioOverviewView clientId={clientId} brandName={brand.name} overview={overview} />
}
