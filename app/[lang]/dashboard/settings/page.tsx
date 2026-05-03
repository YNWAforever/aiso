import { requireAuth } from '@/lib/auth'
import { TopBar } from '@/components/dashboard/TopBar'
import Link from 'next/link'

const PLAN_LABELS: Record<string, string> = {
  basic: 'Basic — $29/month',
  pro: 'Pro — $79/month',
  enterprise: 'Enterprise — $199/month',
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth(lang)
  const plan    = profile.accounts?.plan ?? 'basic'
  const status  = profile.accounts?.status ?? 'active'
  const hasStripe = Boolean(profile.accounts?.stripe_customer_id)

  return (
    <>
      <div className="pt-6 px-6 pb-4 border-b border-[#1e1e30]">
        <p className="text-lg font-bold text-[#e0e0ec] mb-1">Settings</p>
        <p className="text-[12px] text-[#5c5c6e]">Manage your subscription plan and billing.</p>
      </div>

      <main className="flex-1 px-6 py-6 max-w-lg">
        <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-6 space-y-5">
          <div>
            <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-3">Current Plan</p>
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-[#e0e0ec]">{PLAN_LABELS[plan] ?? plan}</span>
              {status !== 'active' && (
                <span className="text-[10px] bg-[#ef444415] text-[#ef4444] px-2 py-0.5 rounded border border-[#ef444420]">
                  {status.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>

          {hasStripe && (
            <div>
              <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-3">Billing</p>
              <a
                href="/api/stripe/portal"
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-[#050510] bg-[#00d4ff] hover:bg-[#00e5ff] transition-colors"
              >
                Manage Billing →
              </a>
              <p className="text-[11px] text-[#5c5c6e] mt-2">
                Update payment method, view invoices, or cancel subscription.
              </p>
            </div>
          )}

          {(plan === 'basic' || plan === 'pro') && (
            <div className="border-t border-[#1e1e30] pt-4">
              <Link
                href={`/${lang}/pricing`}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-[#141422] text-[#e0e0ec] border border-[#1e1e30] hover:bg-[#1e1e38] transition-colors"
              >
                {plan === 'basic' ? 'Upgrade to Pro →' : 'Upgrade to Enterprise →'}
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
