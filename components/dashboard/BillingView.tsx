'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ReceiptText } from 'lucide-react'
import type { ClientBillingViewData } from '@/lib/billing/client-view'

type BillingData = ClientBillingViewData & { plan: string }

// setState-free fetch helper: the mount effect owns every state transition so
// eslint's react-hooks/set-state-in-effect rule has nothing to flag (same
// pattern as app/admin/billing/page.tsx).
async function fetchBilling(): Promise<BillingData | null> {
  const res = await fetch('/api/billing')
  if (!res.ok) return null
  return res.json()
}

/**
 * Client-facing billing view (design slice 4). Billed vs not-yet-billed are
 * rendered separately on purpose: a pending/failed meter report is NOT a charge,
 * and folding the two counts together would show a client a figure Stripe has
 * not accepted.
 */
export function BillingView({ lang }: { lang: string }) {
  const t = useTranslations('billing')
  const [data, setData] = useState<BillingData | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBilling().then(result => {
      if (result === null) setFailed(true)
      else setData(result)
      setLoading(false)
    }).catch(() => {
      setFailed(true)
      setLoading(false)
    })
  }, [])

  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const money = (amountCents: number, currency: string) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountCents / 100)

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'draft': return t('status_draft')
      case 'open': return t('status_open')
      case 'paid': return t('status_paid')
      case 'void': return t('status_void')
      case 'uncollectible': return t('status_uncollectible')
      default: return t('status_unknown')
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('loading')}</p>
  if (failed || !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">{t('load_failed')}</p>
      </div>
    )
  }

  const modeLabel = data.mode === 'metered'
    ? t('mode_metered')
    : data.mode === 'included'
      ? t('mode_included')
      : t('mode_not_opened')

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('plan_label')}</dt>
            <dd className="mt-1 text-lg font-bold text-foreground">{data.plan}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mode_label')}</dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">{modeLabel}</dd>
          </div>
        </dl>
        {data.hasStripeCustomer && (
          /* Ordinary navigation to the existing API redirect; never prefetch Stripe. */
          /* eslint-disable-next-line @next/next/no-html-link-for-pages */
          <a
            href="/api/stripe/portal"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('portal')}
          </a>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground">{t('month_title', { month: data.monthKey })}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-tone-success-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-tone-success-fg">{t('reported_label')}</p>
            <p className="mt-1 text-2xl font-black text-foreground">{data.reportedFixPacks}</p>
          </div>
          <div className="rounded-lg bg-tone-warning-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-tone-warning-fg">{t('not_reported_label')}</p>
            <p className="mt-1 text-2xl font-black text-foreground">{data.notReportedFixPacks}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('not_reported_hint')}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground">{t('invoices_title')}</h2>
        {data.invoices.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <ReceiptText className="size-4" aria-hidden="true" />
            {t('no_invoices')}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-2 py-2 font-medium text-muted-foreground">{t('invoice_description')}</th>
                  <th scope="col" className="px-2 py-2 font-medium text-muted-foreground">{t('invoice_amount')}</th>
                  <th scope="col" className="px-2 py-2 font-medium text-muted-foreground">{t('invoice_status')}</th>
                  <th scope="col" className="px-2 py-2 font-medium text-muted-foreground">{t('invoice_link')}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map(invoice => (
                  <tr key={invoice.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-3 text-foreground">{invoice.description}</td>
                    <td className="px-2 py-3 text-foreground">{money(invoice.amountCents, invoice.currency)}</td>
                    <td className="px-2 py-3 text-muted-foreground">{statusLabel(invoice.status)}</td>
                    <td className="px-2 py-3">
                      {invoice.hostedInvoiceUrl ? (
                        <a
                          href={invoice.hostedInvoiceUrl}
                          className="inline-flex min-h-11 items-center underline text-primary-accessible"
                          rel="noreferrer"
                        >
                          {t('invoice_view')}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{t('invoice_unavailable')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
