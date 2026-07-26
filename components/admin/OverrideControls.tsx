'use client'
import { useState } from 'react'
import { PLAN_IDS, type PlanId } from '@/lib/plans/catalog'

export interface OverrideControlsProps {
  accountId: string
  currentOverride: PlanId | null
  busy: boolean
  onGrant: (accountId: string, plan: PlanId, reason: string, expiresAt: string | null) => void
  onRevoke: (accountId: string) => void
}

export function OverrideControls({
  accountId, currentOverride, busy, onGrant, onRevoke,
}: OverrideControlsProps) {
  const [plan, setPlan] = useState<PlanId>(currentOverride ?? 'pro')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Options come from the catalog, so this cannot drift from pricing. */}
      <select
        value={plan}
        disabled={busy}
        onChange={e => setPlan(e.target.value as PlanId)}
        className="text-xs border border-slate-200 rounded px-2 py-1"
      >
        {PLAN_IDS.map(id => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>

      <input
        value={reason}
        disabled={busy}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (required)"
        maxLength={500}
        className="text-xs border border-slate-200 rounded px-2 py-1"
      />

      <input
        type="date"
        value={expiresAt}
        disabled={busy}
        onChange={e => setExpiresAt(e.target.value)}
        title="Leave empty for a permanent comp"
        className="text-xs border border-slate-200 rounded px-2 py-1"
      />

      <button
        type="button"
        disabled={busy || !reason.trim()}
        onClick={() => onGrant(
          accountId, plan, reason.trim(),
          expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null,
        )}
        className="text-xs rounded bg-slate-900 text-white px-2 py-1 disabled:opacity-40"
      >
        Grant
      </button>

      {currentOverride && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRevoke(accountId)}
          className="text-xs rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
        >
          Revoke
        </button>
      )}
    </div>
  )
}
