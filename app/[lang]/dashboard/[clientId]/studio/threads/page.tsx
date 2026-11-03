import { StudioThreads } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'

export default async function StudioThreadsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  // Staff threads exist only in the viewer's tab; the list shows those.
  await requireStudioBrand(lang, clientId, { allowStaff: true })
  return <StudioThreads clientId={clientId} />
}
