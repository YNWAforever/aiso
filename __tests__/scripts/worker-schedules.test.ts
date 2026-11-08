import { describe, expect, it } from 'vitest'
import { compareSchedules, configuredCrons, expiredLoginMessage } from '@/scripts/worker-schedules.mjs'

/**
 * The readback's pure half. The failure it guards against is silent: a cron in
 * the deployable config that was never deployed simply never fires, and the only
 * symptom is data that does not exist (the brand-months tick, 2026-11-09).
 */
describe('worker schedule drift', () => {
  it('reads the deployable config crons and refuses a config without them', () => {
    expect(configuredCrons({ triggers: { crons: ['17 16 * * *', '17 4 * * *', '17 4 * * *'] } }))
      .toEqual(['17 16 * * *', '17 4 * * *'].sort())
    expect(() => configuredCrons({ triggers: { crons: [] } })).toThrow(/triggers\.crons/)
    expect(() => configuredCrons({})).toThrow(/triggers\.crons/)
  })

  it('reports a config tick the deployed Worker does not run', () => {
    const result = compareSchedules(['17 4 * * *', '17 16 * * *', '47 7 * * 1'], [
      { cron: '17 4 * * *' }, { cron: '47 7 * * 1' },
    ])
    expect(result).toMatchObject({ missing: ['17 16 * * *'], extra: [], drift: true })
  })

  it('reports a deployed tick the config does not describe, and keeps order stable', () => {
    const result = compareSchedules(['17 4 * * *'], [{ cron: '0 9 * * *' }, { cron: '17 4 * * *' }])
    expect(result).toMatchObject({ missing: [], extra: ['0 9 * * *'], drift: true, deployed: ['0 9 * * *', '17 4 * * *'] })
  })

  it('passes when the deployed schedules match, tolerating order and unknown result shapes', () => {
    expect(compareSchedules(['17 4 * * *', '47 7 * * 1'], [{ cron: '47 7 * * 1' }, { cron: '17 4 * * *' }]).drift).toBe(false)
    expect(compareSchedules(['17 4 * * *'], [null, {}, { cron: 42 }])).toMatchObject({ missing: ['17 4 * * *'], extra: [], drift: true })
  })

  it('explains an expired wrangler login with the command that refreshes it', () => {
    const now = Date.parse('2026-11-09T05:00:00Z')
    expect(expiredLoginMessage('2026-11-08T20:40:23.995Z', now)).toContain('npx wrangler whoami')
    expect(expiredLoginMessage('2026-11-09T06:00:00Z', now)).toBeNull()
    expect(expiredLoginMessage(null, now)).toBeNull()
    expect(expiredLoginMessage('not a date', now)).toBeNull()
  })
})
