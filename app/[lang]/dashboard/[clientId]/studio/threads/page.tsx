import { StudioThreads } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'

export default async function StudioThreadsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  // Staff threads are saved only under a live grant (A2b); otherwise they live in the viewer's tab.
  await requireStudioBrand(lang, clientId, { allowStaff: true })
  return <StudioThreads clientId={clientId} />
}
