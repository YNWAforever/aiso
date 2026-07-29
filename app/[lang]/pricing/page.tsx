import { CHECKOUT_PLAN_IDS, type CheckoutPlanId } from '@/lib/plans/catalog'
import { isPlanPurchasable } from '@/lib/stripe'
import { PricingPage } from '@/components/pricing/PricingPage'

// Server Component: resolves which plans are purchasable from server-only
// configuration (lib/stripe.ts reads STRIPE_PRICE_*) and passes only booleans
// across the client boundary. No price id or secret ever reaches the client
// bundle — see components/pricing/PricingPage.tsx for the interactive body.
export default function Page() {
  const purchasable = Object.fromEntries(
    CHECKOUT_PLAN_IDS.map(plan => [plan, isPlanPurchasable(plan)]),
  ) as Partial<Record<CheckoutPlanId, boolean>>

  return <PricingPage purchasable={purchasable} />
}
