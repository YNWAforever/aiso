import { StudioDocuments } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand, loadStudioOutputs } from '@/lib/conversation-studio/secondary'
import { loadStudioDocuments } from '@/lib/conversation-studio/inspector'

export default async function StudioDocumentsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  await requireStudioBrand(lang, clientId)
  const [documents, outputs] = await Promise.all([
    loadStudioDocuments(clientId).catch(() => null), loadStudioOutputs(clientId),
  ])
  return <StudioDocuments clientId={clientId} documents={documents} outputs={outputs} />
}
