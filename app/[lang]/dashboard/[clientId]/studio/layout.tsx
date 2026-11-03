import { StudioShell } from '@/components/dashboard/StudioShell'
import { StudioSessionProvider } from '@/components/dashboard/StudioSession'
import { auditStudioStaffOpen, requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { listOwnedBrands } from '@/lib/workspace/list-owned-brands'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function StudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile, brand, accountId, staff } = await requireStudioBrand(lang, clientId, { allowStaff: true })
  // Staff view (R3 A1): the switcher lists only this brand, and the session never saves.
  if (staff) auditStudioStaffOpen({ actorId: profile.id, accountId, clientId })
  let brands = null
  if (!staff) try { brands = await listOwnedBrands(profile.account_id) } catch { /* Current owned brand is still usable. */ }
  return <StudioSessionProvider key={`${accountId}:${clientId}`} clientId={clientId} persist={!staff}>
    <StudioShell clientId={clientId} brandName={brand.name} brands={brands} features={resolveCommercialEntitlement(profile.accounts).features} admin={Boolean(profile.is_admin)} staff={staff}>{children}</StudioShell>
  </StudioSessionProvider>
}
