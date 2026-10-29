import { StudioTools } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function StudioToolsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile } = await requireStudioBrand(lang, clientId)
  return <StudioTools clientId={clientId} features={resolveCommercialEntitlement(profile.accounts).features} admin={Boolean(profile.is_admin)} />
}
