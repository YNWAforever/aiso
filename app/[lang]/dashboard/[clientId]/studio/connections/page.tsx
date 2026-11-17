import { StudioConnections, type StudioDriveNotice } from '@/components/dashboard/StudioSecondaryViews'
import { requireStudioBrand, loadStudioConnection } from '@/lib/conversation-studio/secondary'
import { isSmeCopilotUiEnabled } from '@/lib/flags'

type SearchParams = Record<string, string | string[] | undefined>

/** The Google callback returns here with ?drive=connected or ?drive=error&reason=… (closed vocabulary). */
function driveNotice(search: SearchParams): StudioDriveNotice | undefined {
  if (search.drive === 'connected') return 'connected'
  if (search.drive === 'error') return search.reason === 'scope_missing' ? 'scope' : 'failed'
  return undefined
}

export default async function StudioConnectionsPage({ params, searchParams }: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { lang, clientId } = await params
  const search = (await searchParams) ?? {}
  const { profile, staff } = await requireStudioBrand(lang, clientId)
  return <StudioConnections clientId={clientId} connection={await loadStudioConnection(profile, clientId)} driveNotice={driveNotice(search)} showTabs={!staff && isSmeCopilotUiEnabled()} />
}
