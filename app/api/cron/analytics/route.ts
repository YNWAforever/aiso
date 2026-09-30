import { openToken } from '@/lib/integrations/google/vault'
import { refreshAccessToken } from '@/lib/integrations/google/oauth'
import { runGoogleCron } from '@/lib/integrations/google/cronRunner'
import { listKeyEvents, listWebStreams, runKeyEventReport } from '@/lib/integrations/analytics/client'
import * as store from '@/lib/integrations/analytics/store'
import { syncAnalyticsBinding } from '@/lib/integrations/analytics/sync'
import type { AnalyticsOutcome } from '@/lib/integrations/analytics/state'
// The Google connection, its sealed secret and its status flip are shared by both
// products, so the token deps are the Search Console store's, as its own cron builds them.
import * as connections from '@/lib/integrations/search-console/store'

export const dynamic = 'force-dynamic'

const SKIPS: ReadonlySet<AnalyticsOutcome> = new Set([
  'not_entitled', 'domain_mismatch', 'scope_missing', 'events_missing',
])

export async function GET(req: Request) {
  return runGoogleCron(req, {
    route: '/api/cron/analytics',
    flag: 'analytics',
    loadDue: store.loadDueAnalyticsBindings,
    skips: SKIPS,
    sync: (binding, cfg, deadline) => syncAnalyticsBinding(binding, {
      loadSecret: connections.loadConnectionSecret,
      open: (sealed, accountId) => openToken(sealed, { accountId }),
      refresh: token => refreshAccessToken(cfg, token),
      markConnection: connections.markConnection,
      getStream: (token, propertyId, streamId) =>
        listWebStreams(token, propertyId).then(list => list.find(s => s.streamId === streamId) ?? null),
      listKeyEvents,
      report: runKeyEventReport,
      replaceDailyWindow: store.replaceDailyWindow,
      recordRun: store.recordAnalyticsRun,
      today: () => new Date().toISOString().slice(0, 10),
      deadline,
    }),
  })
}
