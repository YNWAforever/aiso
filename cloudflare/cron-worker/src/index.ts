export interface Env {
  CRON_SECRET: string
  APP_BASE_URL: string
}

// The exact three schedules Vercel Cron used to run. Keep this in sync with
// wrangler.jsonc's triggers.crons — each key here must have a matching entry
// there, and __tests__/config/function-durations.test.ts (main repo) pins
// wrangler.jsonc against the routes that actually exist.
const ROUTES: Record<string, string> = {
  '17 4 * * 1': '/api/cron/pulse',
  '47 7 * * 1': '/api/cron/evaluate-alerts',
  '0 9 * * *': '/api/cron/trial-emails',
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const path = ROUTES[controller.cron]
    if (!path) {
      console.error(`[cron-worker] no route mapped for cron "${controller.cron}"`)
      return
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
