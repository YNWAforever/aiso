import { getTranslations } from 'next-intl/server'
import { ReportBrandingForm } from '@/components/reports/ReportBrandingForm'
import { requireAuth } from '@/lib/auth'
import { loadReportBranding } from '@/lib/reports/store'
import Link from 'next/link'
import { SettingsView, normalizeSettingsStatus } from '@/components/dashboard/SettingsView'
import { MembersPanel } from '@/components/dashboard/MembersPanel'
import { MAX_ACCOUNT_MEMBERS } from '@/lib/members/schema'
import { loadAccountMembers } from '@/lib/members/store'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { isFeatureEnabled } from '@/lib/flags'
import { listConnections } from '@/lib/integrations/search-console/store'
import { GoogleConnectionsPanel } from '@/components/integrations/GoogleConnectionsPanel'
import { consentErrorFrom } from '@/lib/integrations/google/consent-reasons'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { lang } = await params
  const search = await searchParams
  const profile = await requireAuth(lang)
  const reportT = await getTranslations('reportBranding')
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const plan = entitlement.plan
  const reportBranding = entitlement.features.client_reports_online
    ? await loadReportBranding({ accountId: profile.account_id })
    : null
  const status = normalizeSettingsStatus(profile.accounts?.status)
  const hasStripe = Boolean(profile.accounts?.stripe_customer_id)
  // Not entitlement-gated, unlike report branding: membership is what makes a
  // second party available for approval, and AC-08 asks that of every account
  // rather than of paying ones. The account comes from the session profile —
  // this page never reads an account id from the URL.
  const membership = await loadAccountMembers(profile.account_id)
  const searchConsoleOn = isFeatureEnabled('search_console')
  const searchConsoleEntitled = entitlement.features.search_console
  // A failed read must not take down the whole Settings page (a database
  // error, or the flag switched on before migration 054 is applied): the
  // panel says the list could not load, and everything else still renders.
  let connections: Awaited<ReturnType<typeof listConnections>> = []
  let connectionsLoadFailed = false
  if (searchConsoleOn && searchConsoleEntitled) {
    try {
      connections = await listConnections(profile.account_id)
    } catch (error) {
      // Name only: the Neon driver can echo the connection string in a message.
      console.error('[settings] listConnections failed', { name: error instanceof Error ? error.name : typeof error })
      connectionsLoadFailed = true
    }
  }
  // Only a reason the callback itself generates is shown; anything else is ignored.
  const notice = consentErrorFrom(search)

  return (
    <SettingsView lang={lang} plan={plan} status={status} hasStripe={hasStripe}>
        <MembersPanel
          self={profile.id}
          limit={MAX_ACCOUNT_MEMBERS}
          members={membership.members}
          invitations={membership.invitations}
        />
        {searchConsoleOn && (
          <GoogleConnectionsPanel
            lang={lang}
            entitled={searchConsoleEntitled}
            connections={connections}
            notice={notice}
            loadFailed={connectionsLoadFailed}
          />
        )}
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
