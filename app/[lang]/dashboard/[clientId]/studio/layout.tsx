import { StudioShell } from '@/components/dashboard/StudioShell'
import { StudioSessionProvider } from '@/components/dashboard/StudioSession'
import { requireStudioBrand } from '@/lib/conversation-studio/secondary'
import { listOwnedBrands } from '@/lib/workspace/list-owned-brands'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function StudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const { profile, brand } = await requireStudioBrand(lang, clientId)
  let brands = null
  try { brands = await listOwnedBrands(profile.account_id) } catch { /* Current owned brand is still usable. */ }
  return <StudioSessionProvider key={`${profile.account_id}:${clientId}`}>
    <StudioShell clientId={clientId} brandName={brand.name} brands={brands} features={resolveCommercialEntitlement(profile.accounts).features} admin={Boolean(profile.is_admin)}>{children}</StudioShell>
  </StudioSessionProvider>
}
