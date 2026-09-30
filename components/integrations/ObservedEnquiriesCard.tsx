import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { ObservedFigures } from '@/components/integrations/AnalyticsPanel'
import type { AnalyticsPanel } from '@/lib/integrations/analytics/store'

const copyFor = (lang: string) => (lang === 'zh-HK' ? zhHK : en).analytics

/**
 * The counted outcome, shown beside the modelled Local Trust scenario on the
 * dashboard's ROI step. Deliberately a sibling of LocalTrustStep and not an input
 * to it: nothing here reads the scenario and the scenario reads nothing from here
 * (__tests__/security/outcome-layer-separation.test.ts).
 *
 * The card's one heading is ObservedFigures' own "Observed enquiries", so none is
 * added here. The link goes to the assets page, where the connection and the
 * chosen events are managed. It needs the brand id; the panel does not carry it.
 */
export function ObservedEnquiriesCard({
  lang, panel, clientId,
}: { lang: string; panel: AnalyticsPanel; clientId: string }) {
  return (
    <section className="mt-6 rounded-xl border border-dash-border bg-dash-surface p-4">
      <ObservedFigures panel={panel} lang={lang} />
      <a
        href={`/${lang}/dashboard/${clientId}/assets`}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copyFor(lang).observed_assets_link}
      </a>
    </section>
  )
}
