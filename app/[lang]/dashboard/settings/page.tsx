import { getTranslations } from 'next-intl/server'
import { ReportBrandingForm } from '@/components/reports/ReportBrandingForm'
import { requireAuth } from '@/lib/auth'
import { loadReportBranding } from '@/lib/reports/store'
import Link from 'next/link'
import { SettingsView, normalizeSettingsStatus } from '@/components/dashboard/SettingsView'
import { resolveCommercialEntitlement } from '@/lib/tier'

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
  const status = normalizeSettingsStatus(profile.accounts?.status)
  const hasStripe = Boolean(profile.accounts?.stripe_customer_id)

  return (
    <SettingsView lang={lang} plan={plan} status={status} hasStripe={hasStripe}>
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
    </SettingsView>
  )
}
