import { openToken } from '@/lib/integrations/google/vault'
import { refreshAccessToken } from '@/lib/integrations/google/oauth'
import { runGoogleCron } from '@/lib/integrations/google/cronRunner'
import { querySearchAnalytics } from '@/lib/integrations/search-console/client'
import * as store from '@/lib/integrations/search-console/store'
import { syncBinding } from '@/lib/integrations/search-console/sync'
import type { SyncOutcome } from '@/lib/integrations/search-console/state'

export const dynamic = 'force-dynamic'

const SKIPS: ReadonlySet<SyncOutcome> = new Set(['not_entitled', 'domain_mismatch'])

export async function GET(req: Request) {
  return runGoogleCron(req, {
    route: '/api/cron/search-console',
    flag: 'search_console',
    loadDue: store.loadDueBindings,
    skips: SKIPS,
    sync: (binding, cfg, deadline) => syncBinding(binding, {
      loadSecret: store.loadConnectionSecret,
      open: (sealed, accountId) => openToken(sealed, { accountId }),
      refresh: token => refreshAccessToken(cfg, token),
      query: querySearchAnalytics,
      listPages: store.listSyncPages,
      writeDaily: store.writeDaily,
      writePageQueries: store.writePageQueries,
      markConnection: store.markConnection,
      recordRun: store.recordRun,
      today: () => new Date().toISOString().slice(0, 10),
      deadline,
    }),
  })
}
