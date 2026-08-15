import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type VercelConfig = {
  functions?: Record<string, { maxDuration?: number }>
  crons?: Array<{ path: string; schedule: string }>
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
) as VercelConfig

/**
 * Every route that fans out to an LLM needs a declared maxDuration, because the
 * platform default (10s Hobby / 15s Pro) is far below what one of these costs.
 * A missing key is silent — the route deploys and then times out mid-work —
 * which is exactly how /api/pulse/run shipped unable to finish a single prompt.
 *
 * The `functions` keys are literal paths, not prefixes: `fix/` subroutes inherit
 * nothing from `app/api/fix/route.ts` despite also calling OpenRouter.
 */
const LLM_ROUTES = [
  'app/api/scan/route.ts',
  'app/api/fix/route.ts',
  'app/api/pulse/run/route.ts',
  // Not an LLM caller itself, but it awaits one, so it needs the same headroom.
  'app/api/cron/pulse/route.ts',
  // Not an LLM caller either — it awaits a Resend send per fired alert, serially.
  'app/api/cron/evaluate-alerts/route.ts',
]

describe('Vercel function durations', () => {
  it.each(LLM_ROUTES)('%s declares a maxDuration', (route) => {
    expect(config.functions?.[route]?.maxDuration).toBeTypeOf('number')
  })

  it('keeps every declared duration inside the Hobby ceiling', () => {
    // 60s is the Hobby maximum. Staying under it means the config needs no
    // assumption about which plan the project is on.
    for (const [route, fn] of Object.entries(config.functions ?? {})) {
      expect(fn.maxDuration, `${route} exceeds the 60s Hobby ceiling`)
        .toBeLessThanOrEqual(60)
    }
  })

  it('schedules the Pulse driver, and every cron path is a route that exists', () => {
    // Replaces the assertion that there were no crons at all, which existed so
    // that adding a scheduler had to be a deliberate change here rather than a
    // silent one.
    expect(config.crons).toEqual([
      { path: '/api/cron/pulse', schedule: '17 4 * * 1' },
      { path: '/api/cron/evaluate-alerts', schedule: '47 7 * * 1' },
    ])

    for (const cron of config.crons ?? []) {
      const route = join(process.cwd(), 'app', `${cron.path}/route.ts`)
      expect(existsSync(route), `${cron.path} has no route file`).toBe(true)
      // Vercel Cron issues GET. A cron pointed at a route that exports only POST
      // gets a 405 forever, silently — which is how the producer itself could
      // not have been scheduled directly.
      expect(readFileSync(route, 'utf8')).toMatch(/export async function GET\b/)
    }
  })

  it('evaluates alerts after the rollup they read, on the same day', () => {
    // Alerts compare the latest two aggregate weeks. Run before the week's
    // rollup lands and the comparison is last week against the week before --
    // it would not error, it would just be quietly a week stale, every week.
    const at = (schedule: string) => {
      const [minute, hour, , , weekday] = schedule.split(' ')
      return { weekday, minutes: Number(hour) * 60 + Number(minute) }
    }

    const pulse = config.crons?.find(cron => cron.path === '/api/cron/pulse')
    const alerts = config.crons?.find(cron => cron.path === '/api/cron/evaluate-alerts')
    expect(pulse, 'the Pulse driver is not scheduled').toBeDefined()
    expect(alerts, 'alert evaluation is not scheduled').toBeDefined()

    expect(at(alerts!.schedule).weekday).toBe(at(pulse!.schedule).weekday)
    expect(at(alerts!.schedule).minutes).toBeGreaterThan(at(pulse!.schedule).minutes)
  })

  it('keeps the schedule inside what a Hobby project can actually run', () => {
    // Hobby allows 2 cron jobs at once-per-day granularity; Pro allows 40 at
    // per-minute. Staying daily-or-less keeps this deployable without knowing
    // the plan — which nothing in the repo records. Throughput comes from the
    // driver chaining itself, not from a tighter schedule.
    expect(config.crons?.length ?? 0).toBeLessThanOrEqual(2)

    for (const cron of config.crons ?? []) {
      const [minute, hour] = cron.schedule.split(' ')
      expect(minute, 'a wildcard minute runs every minute — Pro only').not.toMatch(/[*/]/)
      expect(hour, 'a wildcard hour runs hourly — Pro only').not.toMatch(/[*/]/)
    }
  })
})
