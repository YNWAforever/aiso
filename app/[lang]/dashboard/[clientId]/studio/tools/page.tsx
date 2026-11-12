import { StudioTools } from '@/components/dashboard/StudioSecondaryViews'
import { isStudioMcpConfigured } from '@/lib/conversation-studio/mcp/token'
import { isStudioMcpEnabled } from '@/lib/flags'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function StudioToolsPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile } = await requireStudioBrand(lang, clientId)
  // The assistant card only exists when the internal MCP is enabled for this brand
  // and its signing secret is configured; otherwise it would advertise a dead door.
  const mcpEnabled = isStudioMcpEnabled(clientId) && isStudioMcpConfigured()
  return <StudioTools clientId={clientId} features={resolveCommercialEntitlement(profile.accounts).features} admin={Boolean(profile.is_admin)} mcpEnabled={mcpEnabled} />
}
