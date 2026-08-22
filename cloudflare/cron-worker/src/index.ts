export interface Env {
  CRON_SECRET: string
  APP_BASE_URL: string
}

// The exact three schedules Vercel Cron used to run. Keep this in sync with
// wrangler.jsonc's triggers.crons — a test in test/scheduled.test.ts asserts
// the two stay in sync, since nothing at the type level enforces it.
export const ROUTES: Record<string, string> = {
  '17 4 * * 1': '/api/cron/pulse',
  '47 7 * * 1': '/api/cron/evaluate-alerts',
  '0 9 * * *': '/api/cron/trial-emails',
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const path = ROUTES[controller.cron]
    if (!path) {
      console.error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
      throw new Error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
    }

    const res = await fetch(`${env.APP_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    })

    if (!res.ok) {
      // Throwing lets Cloudflare's automatic retry apply — all three downstream
      // routes are idempotent, so a retry is safe.
      throw new Error(`[cron-worker] ${path} responded ${res.status}`)
    }
  },
}
