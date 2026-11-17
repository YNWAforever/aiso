import { StudioThreads } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { isSmeCopilotUiEnabled } from '@/lib/flags'

export default async function StudioThreadsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  // A staff view exists only under a live grant, and its threads are saved there (A2b).
  const { staff } = await requireStudioBrand(lang, clientId, { allowStaff: true })
  // The five Chat tabs replace the old Studio rail only in the SME copilot layout;
  // staff still get the rail, so they must not see a second section nav.
  return <StudioThreads clientId={clientId} showTabs={!staff && isSmeCopilotUiEnabled()} />
}
