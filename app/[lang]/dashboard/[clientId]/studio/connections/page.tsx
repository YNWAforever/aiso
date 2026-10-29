import { StudioConnections } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand, loadStudioConnection } from '@/lib/conversation-studio/secondary'

export default async function StudioConnectionsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile } = await requireStudioBrand(lang, clientId)
  return <StudioConnections clientId={clientId} connection={await loadStudioConnection(profile, clientId)} />
}
