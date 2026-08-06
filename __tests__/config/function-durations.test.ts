import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type VercelConfig = {
  functions?: Record<string, { maxDuration?: number }>
  crons?: unknown[]
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

  it('still declares no crons — nothing schedules the Pulse producer', () => {
    // Pinned so that adding a scheduler has to come with a deliberate change
    // here, and so the docs claiming "no crons" cannot quietly go stale.
    expect(config.crons).toBeUndefined()
  })
})
