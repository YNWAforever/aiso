import { requireAuth } from '@/lib/auth'
import { TopBar } from '@/components/dashboard/TopBar'

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter (Free)',
  pro: 'Pro — $99/month',
  enterprise: 'Enterprise',
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth(lang)
  const plan    = profile.accounts?.plan ?? 'starter'
  const status  = profile.accounts?.status ?? 'active'
  const hasStripe = Boolean(profile.accounts?.stripe_customer_id)

  return (
    <>
      <TopBar title="Settings" />
      <main className="flex-1 px-6 py-8 max-w-lg">
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          {/* Plan */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Current Plan</p>
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-slate-900">{PLAN_LABELS[plan] ?? plan}</span>
              {status !== 'active' && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">
                  {status.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>

          {/* Billing */}
          {hasStripe && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-3">Billing</p>
              <a
                href="/api/stripe/portal"
                className="inline-block bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition"
              >
                Manage Billing →
              </a>
              <p className="text-xs text-slate-400 mt-2">
                Update payment method, view invoices, or cancel subscription.
              </p>
            </div>
          )}

          {plan === 'starter' && (
            <div className="border-t border-slate-100 pt-4">
              <a
                href={`/${lang}/pricing`}
                className="inline-block bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition"
              >
                Upgrade to Pro →
              </a>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
