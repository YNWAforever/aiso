import { getTranslations } from 'next-intl/server'
import { ReportBrandingForm } from '@/components/reports/ReportBrandingForm'
import { requireAuth } from '@/lib/auth'
import { loadReportBranding } from '@/lib/reports/store'
import Link from 'next/link'
import { resolveCommercialEntitlement } from '@/lib/tier'

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  basic: 'Basic — $29/month',
  pro: 'Pro — $79/month',
  enterprise: 'Enterprise — $199/month',
}

const UPGRADE_LABELS: Record<string, string> = {
  free: 'Upgrade to Basic →',
  basic: 'Upgrade to Pro →',
  pro: 'Upgrade to Enterprise →',
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth(lang)
  const reportT = await getTranslations('reportBranding')
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const plan = entitlement.plan
  const reportBranding = entitlement.features.client_reports_online
    ? await loadReportBranding({ accountId: profile.account_id })
    : null
  const status  = profile.accounts?.status ?? 'active'
  const hasStripe = Boolean(profile.accounts?.stripe_customer_id)

  return (
    <>
      <div className="pt-6 px-6 pb-4 border-b border-border">
        <p className="text-lg font-bold text-foreground mb-1">Settings</p>
        <p className="text-2xs text-muted-foreground">Manage your subscription plan and billing.</p>
      </div>

      <main className="flex-1 px-6 py-6 max-w-5xl space-y-8">
        <div className="rounded-xl border border-border bg-card p-6 space-y-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-3">Current Plan</p>
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-foreground">{PLAN_LABELS[plan] ?? plan}</span>
              {status !== 'active' && (
                <span className="text-2xs bg-destructive/10 text-destructive px-2 py-0.5 rounded border border-destructive/20">
                  {status.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>

          {hasStripe && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-3">Billing</p>
              {/* API-route redirect to Stripe's portal — <Link> cannot navigate to route handlers */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/api/stripe/portal"
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-primary-foreground bg-primary hover:bg-primary/90 transition-colors shadow-sm"
              >
                Manage Billing →
              </a>
              <p className="text-xs- text-muted-foreground mt-2">
                Update payment method, view invoices, or cancel subscription.
              </p>
            </div>
          )}

          {(plan === 'free' || plan === 'basic' || plan === 'pro') && (
            <div className="border-t border-border pt-4">
              <Link
                href={`/${lang}/pricing`}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-secondary text-foreground border border-border hover:bg-secondary/80 transition-colors"
              >
                {UPGRADE_LABELS[plan]}
              </Link>
            </div>
          )}
        </div>
        <section id="report-branding" className="scroll-mt-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-foreground">{reportT('title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{reportT('settings_body')}</p>
          </div>
          {entitlement.features.client_reports_online ? (
            <ReportBrandingForm
              initialBranding={reportBranding ?? {
                agencyName: '',
                logoUrl: null,
                primaryColor: '#1D4ED8',
                contactLabel: null,
                contactUrl: null,
              }}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <p className="font-semibold text-foreground">{reportT('upgrade_title')}</p>
              <p className="mt-2 text-sm text-muted-foreground">{reportT('upgrade_body')}</p>
              <Link
                href={`/${lang}/pricing`}
                className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {reportT('upgrade_cta')}
              </Link>
            </div>
          )}
        </section>

      </main>
    </>
  )
}
