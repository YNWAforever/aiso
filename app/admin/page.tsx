'use client'
import { useEffect, useState } from 'react'

interface AccountRow {
  id: string
  plan: string
  status: string
  clients: { id: string; brand_name: string; status: string }[]
  profiles: { display_name: string | null }[]
}

export default function AdminPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/admin/clients').then(r => r.json()).then(d => {
      setAccounts(d)
      setLoading(false)
    })
  }, [])

  const changePlan = async (accountId: string, plan: string) => {
    await fetch('/api/admin/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, plan }),
    })
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, plan } : a))
  }

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <h1 className="text-xl font-black text-slate-900 mb-6">All Accounts</h1>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="px-4 py-3 text-slate-500 font-medium">Account</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Brands</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Status</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Plan</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-slate-700">
                  {a.profiles?.[0]?.display_name ?? a.id.slice(0, 8)}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {a.clients?.map(c => c.brand_name).join(', ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={a.plan}
                    onChange={e => changePlan(a.id, e.target.value)}
                    className="text-xs border border-slate-200 rounded px-2 py-1"
                  >
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
