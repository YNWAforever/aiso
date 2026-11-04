import { StudioThreads } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'

export default async function StudioThreadsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  // A staff view exists only under a live grant, and its threads are saved there (A2b).
  await requireStudioBrand(lang, clientId, { allowStaff: true })
  return <StudioThreads clientId={clientId} />
}
