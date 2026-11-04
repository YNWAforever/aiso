import { StudioShell } from '@/components/dashboard/StudioShell'
import { StudioSessionProvider } from '@/components/dashboard/StudioSession'
import { auditStudioStaffOpen, requireStudioBrand, staffCanSaveThreads } from '@/lib/conversation-studio/secondary'
import { listOwnedBrands } from '@/lib/workspace/list-owned-brands'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function StudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile, brand, accountId, staff } = await requireStudioBrand(lang, clientId, { allowStaff: true })
  // Staff view (R3): the switcher lists only this brand, and the open is
  // recorded in the client account's audit before anything renders.
  if (staff) await auditStudioStaffOpen({ actorId: profile.id, accountId, clientId })
  // A2b: with a live grant from the client account, staff threads are saved there.
  const persist = !staff || await staffCanSaveThreads({ accountId, profileId: profile.id })
  let brands = null
  if (!staff) try { brands = await listOwnedBrands(profile.account_id) } catch { /* Current owned brand is still usable. */ }
  return <StudioSessionProvider key={`${accountId}:${clientId}`} clientId={clientId} persist={persist}>
    <StudioShell clientId={clientId} brandName={brand.name} brands={brands} features={resolveCommercialEntitlement(profile.accounts).features} admin={Boolean(profile.is_admin)} staff={staff} staffSaves={staff && persist}>{children}</StudioShell>
  </StudioSessionProvider>
}
