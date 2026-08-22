import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type VercelConfig = {
  functions?: Record<string, { maxDuration?: number }>
}

type WranglerConfig = {
  triggers?: { crons?: string[] }
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
) as VercelConfig

// wrangler.jsonc allows `//` comments, which JSON.parse rejects — strip them
// before parsing. Only strips a `//` that starts a line (after whitespace) or
// follows a comma/brace, so it can't misfire inside a string value like a URL.
function parseWranglerJsonc(raw: string): WranglerConfig {
  const withoutComments = raw.replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(withoutComments) as WranglerConfig
}

const workerConfig = parseWranglerJsonc(
  readFileSync(join(process.cwd(), 'cloudflare/cron-worker/wrangler.jsonc'), 'utf8'),
)

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
  // Same shape as evaluate-alerts: a Resend send per due email, serially.
  'app/api/cron/trial-emails/route.ts',
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

  it('no longer schedules anything from vercel.json — Cloudflare owns that now', () => {
    expect((config as { crons?: unknown[] }).crons ?? []).toEqual([])
  })
})

describe('Cloudflare cron-worker schedule', () => {
  it('schedules exactly the three cron routes, and every one exists', () => {
    expect(workerConfig.triggers?.crons).toEqual([
      '17 4 * * 1',
      '47 7 * * 1',
      '0 9 * * *',
    ])

    const paths = ['/api/cron/pulse', '/api/cron/evaluate-alerts', '/api/cron/trial-emails']
    for (const path of paths) {
      const route = join(process.cwd(), 'app', `${path}/route.ts`)
      expect(existsSync(route), `${path} has no route file`).toBe(true)
      // The Worker calls with GET, mirroring what Vercel Cron used to send.
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

    const crons = workerConfig.triggers?.crons ?? []
    const pulse = at(crons[0])
    const alerts = at(crons[1])

    expect(alerts.weekday).toBe(pulse.weekday)
    expect(alerts.minutes).toBeGreaterThan(pulse.minutes)
  })

  it('stays within the Cloudflare free tier of 3 triggers per Worker', () => {
    expect(workerConfig.triggers?.crons?.length ?? 0).toBeLessThanOrEqual(3)
  })
})
