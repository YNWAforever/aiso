import { StudioOverviewView } from '@/components/dashboard/StudioOverviewViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { loadStudioOpportunities } from '@/lib/conversation-studio/opportunities'
import { loadStudioOverview } from '@/lib/conversation-studio/overview'

export default async function StudioOverviewPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile, brand } = await requireStudioBrand(lang, clientId)
  // Saved data only: no model, provider or Google call on this page.
  const opportunities = await loadStudioOpportunities(clientId, lang).catch(() => null)
  const overview = await loadStudioOverview(profile, clientId, opportunities)
  return <StudioOverviewView clientId={clientId} brandName={brand.name} overview={overview} />
}
