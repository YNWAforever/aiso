'use client'
import { useEffect, useState } from 'react'
import type { PlanId } from '@/lib/plans/catalog'

type BillingMode = 'included' | 'metered' | null

type FailedEvent = {
  eventId: string
  fixPackId: string
  attempts: number
  lastErrorCode: string | null
  createdAt: string
}

type OverviewAccount = {
  accountId: string
  ownerEmail: string | null
  plan: string | null
  status: string | null
  mode: BillingMode
  hasStripeCustomer: boolean
  hasSubscription: boolean
  usage: { reported: number; pending: number; failed: number }
  failedEvents: FailedEvent[]
}

type Overview = { month: string; accounts: OverviewAccount[] }

const PLAN_OPTIONS: PlanId[] = ['basic', 'pro', 'enterprise']

// Deliberately setState-free (same reason as app/admin/billing/page.tsx): the
// mount effect and each action keep every state transition.
async function fetchOverview(): Promise<Overview | null> {
  const res = await fetch('/api/admin/billing/per-fix')
  if (!res.ok) return null
  return res.json()
}

async function postJson(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, data }
}

export function PerFixBillingPanel() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [planChoice, setPlanChoice] = useState<Record<string, PlanId>>({})

  // Invoice form state.
  const [invoiceAccountId, setInvoiceAccountId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<'usd' | 'hkd'>('usd')
  const [invoiceResult, setInvoiceResult] = useState<string>('')
  const [stripeInvoiceId, setStripeInvoiceId] = useState('')

  const reload = () => {
    fetchOverview().then(result => {
      if (result === null) setError('Failed to load per-fix billing.')
      else {
        setData(result)
        setError('')
      }
      setLoading(false)
    }).catch(() => {
      setError('Failed to load per-fix billing.')
      setLoading(false)
    })
  }

  useEffect(() => {
    fetchOverview().then(result => {
      if (result === null) setError('Failed to load per-fix billing.')
      else setData(result)
      setLoading(false)
    }).catch(() => {
      setError('Failed to load per-fix billing.')
      setLoading(false)
    })
  }, [])

  const setMode = async (account: OverviewAccount, mode: 'included' | 'metered') => {
    setBusyKey(account.accountId)
    setError('')
    setNotice('')
    try {
      const body: Record<string, unknown> = { accountId: account.accountId, mode }
      if (mode === 'metered' && !account.hasSubscription) {
        body.plan = planChoice[account.accountId] ?? 'basic'
        body.createSubscription = true
      }
      const { ok, data: payload } = await postJson('/api/admin/billing/accounts', body)
      if (!ok) setError(String(payload.message ?? payload.error ?? 'Billing control failed.'))
      else {
        setNotice(`Billing opened as ${mode} for ${account.ownerEmail ?? account.accountId}.`)
        reload()
      }
    } catch {
      setError('Billing control failed.')
    } finally {
      setBusyKey(null)
    }
  }

  const retry = async (eventId: string) => {
    setBusyKey(eventId)
    setError('')
    setNotice('')
    try {
      const { ok, data: payload } = await postJson(`/api/admin/billing/usage/${eventId}/retry`, {})
      if (!ok) setError(String(payload.error ?? 'Retry failed.'))
      else {
        setNotice(`Meter event ${eventId.slice(0, 8)} reported to Stripe.`)
        reload()
      }
    } catch {
      setError('Retry failed.')
    } finally {
      setBusyKey(null)
    }
  }

  const issueInvoice = async () => {
    setBusyKey('invoice')
    setError('')
    setNotice('')
    setInvoiceResult('')
    try {
      const dollars = Number(amount)
      if (!invoiceAccountId) {
        setError('Choose an account first.')
        return
      }
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setError('Enter a positive amount.')
        return
      }
      const { ok, data: payload } = await postJson('/api/admin/billing/invoices', {
        accountId: invoiceAccountId,
        description,
        amountCents: Math.round(dollars * 100),
        currency,
      })
      if (!ok) {
        const hosted = typeof payload.hostedInvoiceUrl === 'string' ? payload.hostedInvoiceUrl : ''
        const stripeId = typeof payload.stripeInvoiceId === 'string' ? payload.stripeInvoiceId : ''
        setError(
          hosted
            ? `Stripe invoice ${stripeId} was created but the local mirror failed. It is NOT lost: re-mirror it below. ${hosted}`
            : String(payload.message ?? payload.error ?? 'Invoice failed.'),
        )
        if (stripeId) setStripeInvoiceId(stripeId)
      } else {
        const invoice = (payload.invoice ?? {}) as Record<string, unknown>
        setInvoiceResult(String(invoice.hostedInvoiceUrl ?? ''))
        setDescription('')
        setAmount('')
        reload()
      }
    } catch {
      setError('Invoice failed.')
    } finally {
      setBusyKey(null)
    }
  }

  const repairMirror = async () => {
    setBusyKey('mirror')
    setError('')
    setNotice('')
    try {
      const { ok, data: payload } = await postJson('/api/admin/billing/invoices', { stripeInvoiceId })
      if (!ok) setError(String(payload.message ?? payload.error ?? 'Mirror repair failed.'))
      else {
        setNotice(`Mirrored ${stripeInvoiceId}.`)
        reload()
      }
    } catch {
      setError('Mirror repair failed.')
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading per-fix billing…</p>
  if (!data) return <p className="text-sm text-red-600">{error || 'Failed to load per-fix billing.'}</p>

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-lg font-black text-slate-900">Per-fix billing</h2>
        <p className="mb-3 text-sm text-slate-500">
          Meter counts cover the Hong Kong month {data.month}. Reported means Stripe accepted the meter event;
          pending and failed are <strong>not billed</strong>.
        </p>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {notice && <p className="mb-2 text-sm text-emerald-700">{notice}</p>}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="px-4 py-3 font-medium text-slate-500">Account</th>
                <th className="px-4 py-3 font-medium text-slate-500">Mode</th>
                <th className="px-4 py-3 font-medium text-slate-500">Reported</th>
                <th className="px-4 py-3 font-medium text-slate-500">Pending</th>
                <th className="px-4 py-3 font-medium text-slate-500">Failed</th>
                <th className="px-4 py-3 font-medium text-slate-500">Controls</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map(account => (
                <tr key={account.accountId} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{account.ownerEmail ?? '(no owner email)'}</p>
                    <p className="text-xs text-slate-400">{account.accountId}</p>
                    <p className="text-xs text-slate-500">
                      {account.plan ?? 'free'} · {account.status ?? 'unknown'}
                      {account.hasSubscription ? ' · subscription' : ' · no subscription'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${account.mode === 'metered' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : account.mode === 'included' ? 'bg-slate-50 text-slate-600 ring-slate-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>
                      {account.mode ?? 'not opened'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{account.usage.reported}</td>
                  <td className="px-4 py-3 text-amber-700">{account.usage.pending}</td>
                  <td className="px-4 py-3 text-red-600">{account.usage.failed}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyKey !== null || account.mode === 'included'}
                        onClick={() => setMode(account, 'included')}
                        className="min-h-9 rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Set included
                      </button>
                      {account.hasSubscription ? (
                        <button
                          type="button"
                          disabled={busyKey !== null || account.mode === 'metered'}
                          onClick={() => setMode(account, 'metered')}
                          className="min-h-9 rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          Set metered
                        </button>
                      ) : (
                        <span className="flex items-center gap-1">
                          <select
                            aria-label={`Plan for ${account.ownerEmail ?? account.accountId}`}
                            value={planChoice[account.accountId] ?? 'basic'}
                            onChange={event => setPlanChoice(current => ({
                              ...current,
                              [account.accountId]: event.target.value as PlanId,
                            }))}
                            className="min-h-9 rounded-lg border border-slate-300 px-2 text-xs"
                          >
                            {PLAN_OPTIONS.map(plan => <option key={plan} value={plan}>{plan}</option>)}
                          </select>
                          <button
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() => setMode(account, 'metered')}
                            className="min-h-9 rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            Start metered subscription
                          </button>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-black text-slate-900">Failed meter events</h2>
        <p className="mb-3 text-sm text-slate-500">
          Retrying re-sends the same Stripe identifier, so it cannot double-charge. The 24-hour retry window and attempt
          cap are enforced server-side.
        </p>
        {data.accounts.every(account => account.failedEvents.length === 0) ? (
          <p className="text-sm text-slate-500">No failed meter events.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-4 py-3 font-medium text-slate-500">Event</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Account</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Attempts</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Last error</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Created</th>
                  <th className="px-4 py-3 font-medium text-slate-500" />
                </tr>
              </thead>
              <tbody>
                {data.accounts.flatMap(account => account.failedEvents.map(event => (
                  <tr key={event.eventId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{event.eventId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{account.ownerEmail ?? account.accountId}</td>
                    <td className="px-4 py-3 text-slate-700">{event.attempts}</td>
                    <td className="px-4 py-3 font-mono text-xs text-red-600">{event.lastErrorCode ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(event.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => retry(event.eventId)}
                        className="min-h-9 rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-lg font-black text-slate-900">Issue a one-off invoice</h2>
        <p className="mb-3 text-sm text-slate-500">
          Stripe emails the customer a hosted invoice. Nothing is written locally unless Stripe created the invoice
          first; a failed mirror is reported with the Stripe id so it can be repaired here.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Account</span>
            <select
              value={invoiceAccountId}
              onChange={event => setInvoiceAccountId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
            >
              <option value="">Choose an account…</option>
              {data.accounts.map(account => (
                <option key={account.accountId} value={account.accountId}>
                  {account.ownerEmail ?? account.accountId}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Description (3–500 chars)</span>
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={500}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Amount (dollars)</span>
            <input
              value={amount}
              onChange={event => setAmount(event.target.value)}
              inputMode="decimal"
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Currency</span>
            <select
              value={currency}
              onChange={event => setCurrency(event.target.value === 'hkd' ? 'hkd' : 'usd')}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
            >
              <option value="usd">USD</option>
              <option value="hkd">HKD</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={issueInvoice}
            className="min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Issue invoice
          </button>
          {invoiceResult && (
            <a className="text-sm underline" href={invoiceResult} rel="noreferrer">Open hosted invoice</a>
          )}
        </div>
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Repair a mirror</h3>
          <p className="mb-2 text-xs text-slate-500">
            Use this when Stripe succeeded but billing_invoices did not get the row. It never issues a second invoice.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Stripe invoice id (in_…)</span>
              <input
                value={stripeInvoiceId}
                onChange={event => setStripeInvoiceId(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3"
              />
            </label>
            <button
              type="button"
              disabled={busyKey !== null || !stripeInvoiceId}
              onClick={repairMirror}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              Re-mirror
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
