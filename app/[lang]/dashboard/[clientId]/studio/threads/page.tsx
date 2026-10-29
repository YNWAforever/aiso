import { StudioThreads } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'

export default async function StudioThreadsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  await requireStudioBrand(lang, clientId)
  return <StudioThreads clientId={clientId} />
}
