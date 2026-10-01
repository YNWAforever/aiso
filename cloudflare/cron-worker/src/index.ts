export interface Env {
  CRON_SECRET: string
  APP_BASE_URL: string
}

// Keep in sync with wrangler.jsonc's triggers.crons — test/scheduled.test.ts
// asserts the keys agree. A schedule may call several routes: the free tier
// allows three triggers per Worker and all three are used, so the daily trigger
// carries trial emails, the Search Console sync and the Analytics sync.
export const ROUTES: Record<string, readonly string[]> = {
  '17 4 * * 1': ['/api/cron/pulse'],
  '47 7 * * 1': ['/api/cron/evaluate-alerts'],
  '0 9 * * *': ['/api/cron/trial-emails', '/api/cron/search-console', '/api/cron/analytics'],
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
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
    }))

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failures.length) {
      // Propagate the failed attempt(s); this Worker does not implement retries.
      throw new Error(failures.map(f => (f.reason as Error).message).join('; '))
    }
  },
}
