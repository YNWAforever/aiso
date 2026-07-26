'use client'
import { useEffect, useState } from 'react'
import type { PlanId } from '@/lib/plans/catalog'
import { AccountRow, type AdminAccount } from '@/components/admin/AccountRow'

// Deliberately setState-free: it only fetches and returns data, so eslint's
// react-hooks/set-state-in-effect rule has nothing to flag when the mount
// effect below calls it. That rule flags any function reachable from an
// effect body that itself calls a setState setter — including one only
// reached after an await — so setting state has to stay with each caller
// (the effect, and send()'s post-mutation refetch) instead of living here.
async function fetchAccounts(): Promise<AdminAccount[] | null> {
  const res = await fetch('/api/admin/clients')
  if (!res.ok) return null
  return res.json()
}

export default function AdminPage() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAccounts().then(data => {
      if (data === null) setError('Failed to load accounts.')
      else setAccounts(data)
      setLoading(false)
    })
  }, [])

  // Refetch rather than patching local state: entitlement is resolved
  // server-side, so the client cannot recompute it correctly.
  const send = async (body: Record<string, unknown>, accountId: string) => {
    setBusyId(accountId)
    setError('')
    const res = await fetch('/api/admin/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Request failed.')
    } else {
      const data = await fetchAccounts()
      if (data === null) setError('Failed to load accounts.')
      else setAccounts(data)
    }
    setBusyId(null)
  }

  const onGrant = (accountId: string, plan: PlanId, reason: string, expiresAt: string | null) =>
    send({ accountId, action: 'grant', plan, reason, expiresAt }, accountId)

  const onRevoke = (accountId: string) =>
    send({ accountId, action: 'revoke' }, accountId)

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <h1 className="text-xl font-black text-slate-900 mb-6">All Accounts</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="px-4 py-3 text-slate-500 font-medium">Account</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Brands</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Stripe</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Effective</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Override</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <AccountRow
                key={a.id}
                account={a}
                busy={busyId === a.id}
                onGrant={onGrant}
                onRevoke={onRevoke}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
