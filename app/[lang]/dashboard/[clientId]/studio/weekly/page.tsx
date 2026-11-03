import { StudioWeeklyView } from '@/components/dashboard/StudioOverviewViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { loadStudioWeeks } from '@/lib/conversation-studio/overview'

export default async function StudioWeeklyPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { accountId } = await requireStudioBrand(lang, clientId, { allowStaff: true })
  const weeks = await loadStudioWeeks(accountId, clientId)
  return <StudioWeeklyView clientId={clientId} weeks={weeks} />
}
