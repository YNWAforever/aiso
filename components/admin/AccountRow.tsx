'use client'
import type { PlanId } from '@/lib/plans/catalog'
import { OverrideControls } from './OverrideControls'

export interface AdminAccount {
  id: string
  plan: string
  status: string
  hasSubscription: boolean
  override_plan: PlanId | null
  override_reason: string | null
  override_expires_at: string | null
  override_set_by_name: string | null
  display_name: string | null
  clients: { id: string; brand_name: string; status: string }[]
  entitlement: {
    plan: PlanId
    source: string
    features: { max_brands: number; history_weeks: number; alerts: boolean; csv_export: boolean }
  }
}

export interface AccountRowProps {
  account: AdminAccount
  busy: boolean
  onGrant: (accountId: string, plan: PlanId, reason: string, expiresAt: string | null) => void
  onRevoke: (accountId: string) => void
}

export function AccountRow({ account, busy, onGrant, onRevoke }: AccountRowProps) {
  const { entitlement: ent } = account
  const overridden = ent.source === 'override'
  // A time-boxed comp that has passed its expiry still has override_plan set —
  // nothing sweeps expired rows — but no longer wins resolution. Track that
  // separately from `overridden`, because the Revoke button is gated on
  // override_plan: without this the row would show a plain grey badge with no
  // trace a comp ever existed, next to a Revoke button with no visible referent.
  const lapsed = account.override_plan !== null && !overridden

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-4 py-3 text-slate-700">
        {account.display_name ?? account.id.slice(0, 8)}
      </td>

      <td className="px-4 py-3 text-slate-500">
        {account.clients?.map(c => c.brand_name).join(', ') || '—'}
      </td>

      {/* Stripe-derived state */}
      <td className="px-4 py-3 text-xs text-slate-500">
        {account.plan} / {account.status}
        <br />
        {account.hasSubscription ? 'subscription' : 'no subscription'}
      </td>

      {/* What the customer actually gets */}
      <td className="px-4 py-3 text-xs">
        <span className={`px-2 py-0.5 rounded font-medium ${
          overridden ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
        }`}>
          {ent.plan} ({ent.source})
        </span>
        {lapsed && (
          <span className="ml-1 px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-500">
            {account.override_plan} comp expired
          </span>
        )}
        {(overridden || lapsed) && (
          <div className="mt-1 text-[11px] text-slate-500">
            {account.override_reason}
            {account.override_set_by_name ? ` · by ${account.override_set_by_name}` : ''}
            {account.override_expires_at
              ? ` · ${lapsed ? 'expired' : 'until'} ${new Date(account.override_expires_at).toLocaleDateString()}`
              : ' · permanent'}
          </div>
        )}
        {/* Rendered from the catalog rather than restated here. */}
        <div className="mt-1 text-[11px] text-slate-500">
          {ent.features.max_brands} brands · {ent.features.history_weeks}w history
          {ent.features.alerts ? ' · alerts' : ''}
          {ent.features.csv_export ? ' · csv' : ''}
        </div>
      </td>

      <td className="px-4 py-3">
        <OverrideControls
          accountId={account.id}
          currentOverride={account.override_plan}
          busy={busy}
          onGrant={onGrant}
          onRevoke={onRevoke}
        />
      </td>
    </tr>
  )
}
