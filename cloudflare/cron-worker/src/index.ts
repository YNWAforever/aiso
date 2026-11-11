export interface Env {
  CRON_SECRET: string
  APP_BASE_URL: string
}

// Scheduled keys match both wrangler configs. `0 9 * * *` runs the trial drip
// and Search Console daily (approved 2026-11-11); it sends real customer email.
// `17 16 * * *` is 16:17 UTC, which is 00:17 in Hong Kong and Singapore
// (UTC+8), and calls brand-months only.
export const ROUTES: Record<string, readonly string[]> = {
  // Daily verified-live baseline: pulse plus saved-raw repair. The driver only
  // picks clients whose week is not yet rolled up, so Tuesday–Sunday firings
  // finish weeks a failed hop left incomplete. Search Console and outcomes stay off.
  '17 4 * * *': ['/api/cron/pulse', '/api/cron/pulse?mode=repair'],
  '47 7 * * 1': ['/api/cron/evaluate-alerts'],
  '0 9 * * *': ['/api/cron/trial-emails', '/api/cron/search-console'],
  '17 16 * * *': ['/api/cron/brand-months'],
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // A downstream request can finish with an unknown external outcome.
    // Disable runtime retry before the first request; the app ledger owns repair.
    controller.noRetry()
    const paths = ROUTES[controller.cron]
    if (!paths?.length) {
      console.error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
      throw new Error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
    }

    // Independent calls: one route failing must never skip another.
    const results = await Promise.allSettled(paths.map(async path => {
      const res = await fetch(`${env.APP_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      })
      if (!res.ok) throw new Error(`[cron-worker] ${path} responded ${res.status}`)
      console.info({event:'cron_worker_response',route:path,status:res.status,outcome:res.headers?.get('x-aiso-outcome')??'unknown'})
    }))

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failures.length) {
      // Propagate the failed attempt(s); this Worker does not implement retries.
      throw new Error(failures.map(f => (f.reason as Error).message).join('; '))
    }
  },
}
