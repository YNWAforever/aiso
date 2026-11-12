import { StudioShell } from '@/components/dashboard/StudioShell'
import { StudioSessionProvider } from '@/components/dashboard/StudioSession'
import { isSmeCopilotUiEnabled } from '@/lib/flags'
import { auditStudioStaffOpen, requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { listOwnedBrands } from '@/lib/workspace/list-owned-brands'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function StudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile, brand, accountId, staff } = await requireStudioBrand(lang, clientId, { allowStaff: true })
  // Staff view (R3, only under a live grant): the switcher lists only this brand,
  // threads are saved in the client account, and the open is recorded in its
  // audit before anything renders.
  if (staff) await auditStudioStaffOpen({ actorId: profile.id, accountId, clientId })
  let brands = null
  if (!staff) try { brands = await listOwnedBrands(profile.account_id) } catch { /* Current owned brand is still usable. */ }
  // Approved SME copilot IA: Chat is a dashboard destination, so the Studio-owned
  // rail is not rendered. The dashboard chrome (one sidebar + one top bar) already
  // surrounds this layout; #aiso-studio keeps the Studio token scope without the
  // full-bleed `.as-shell` grid. Staff view keeps its rail for the R3 banner.
  const smeCopilot = !staff && isSmeCopilotUiEnabled()
  const content = smeCopilot
    ? <div id="aiso-studio">{children}</div>
    : <StudioShell clientId={clientId} brandName={brand.name} brands={brands} features={resolveCommercialEntitlement(profile.accounts).features} admin={Boolean(profile.is_admin)} staff={staff}>{children}</StudioShell>
  return <StudioSessionProvider key={`${accountId}:${clientId}`} clientId={clientId}>{content}</StudioSessionProvider>
}
