import { StudioWeeklyView } from '@/components/dashboard/StudioOverviewViews'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { loadStudioWeeks } from '@/lib/conversation-studio/overview'

export default async function StudioWeeklyPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile } = await requireStudioBrand(lang, clientId)
  const weeks = await loadStudioWeeks(profile.account_id, clientId)
  return <StudioWeeklyView clientId={clientId} weeks={weeks} />
}
