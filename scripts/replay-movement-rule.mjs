/**
 * Q1 replay: run the monthly report's movement rule over the stored Pulse weeks
 * and print what the report would freeze for each brand-month.
 *
 * The rule refuses a direction unless three consecutive week-to-week comparisons
 * move the same way with at least five answers behind every week
 * (lib/monthly-report/movement.ts). Q1 is only "decided" once this has been run
 * against a month that actually holds four consecutive weeks; until then the
 * replay's job is to say, loudly, that the data is not there yet.
 *
 * Read-only: it reads pulse_weekly_summary and brand_month_snapshots and writes
 * nothing. Usage:
 *
 *   npm run report:movement-replay            (human output)
 *   npm run report:movement-replay -- --json  (machine output)
 */
import { neon } from '@neondatabase/serverless'
import {
  MOVEMENT_MIN_ANSWERS_PER_WEEK, MOVEMENT_MIN_WEEKS, MOVEMENT_WEEK_WINDOW,
  buildVisibility, decideMovement,
} from '../lib/monthly-report/movement.ts'
import { PLAN_CATALOG, PLAN_IDS } from '../lib/plans/catalog.ts'
import { pulsePlatformsFor } from '../lib/pulse/platforms.ts'

const DAY_MS = 86_400_000
const weekIndex = week => Math.floor(Date.parse(`${week}T00:00:00Z`) / DAY_MS)

const PAID_PLANS = new Set(['basic', 'pro', 'enterprise'])
const KNOWN_PLANS = new Set(PLAN_IDS)

function timestampMs(raw) {
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw === 'string') return new Date(raw).getTime()
  return Number.NaN
}

/**
 * The account's effective plan and source, mirroring lib/tier.ts's branch order.
 *
 * This is a copy, not an import: plain Node's type-stripping loader cannot
 * resolve the app's `@/` alias, and lib/tier.ts's catalog import is aliased. The
 * parity cases in __tests__/scripts/movement-replay.test.ts compare every branch
 * against resolveCommercialEntitlement, so a change there fails that test rather
 * than letting this copy drift silently.
 */
export function resolveFeedEntitlement(account, now = new Date()) {
  if (!account) return { plan: 'free', source: 'free' }

  const overridePlan = typeof account.override_plan === 'string' && KNOWN_PLANS.has(account.override_plan)
    ? account.override_plan
    : null
  if (overridePlan) {
    const raw = account.override_expires_at
    // A null expiry means permanent; a malformed one voids the override.
    if (raw === null || raw === undefined) return { plan: overridePlan, source: 'override' }
    const expiry = timestampMs(raw)
    if (Number.isFinite(expiry) && expiry > now.getTime()) return { plan: overridePlan, source: 'override' }
  }

  if (account.status === 'past_due') return { plan: 'free', source: 'past_due' }
  if (account.status === 'cancelled') return { plan: 'free', source: 'cancelled' }

  const plan = typeof account.plan === 'string' && PAID_PLANS.has(account.plan) ? account.plan : null
  if (!plan) return { plan: 'free', source: 'free' }

  const trialExpiry = timestampMs(account.trial_ends_at)
  const trialIsLive = Number.isFinite(trialExpiry) && trialExpiry > now.getTime()
  const hasSubscription = typeof account.stripe_subscription_id === 'string' && account.stripe_subscription_id.length > 0

  if (account.status === 'active' && hasSubscription) return { plan, source: 'paid' }
  if (trialIsLive || (account.status === 'trialing' && hasSubscription)) return { plan, source: 'trial' }
  return { plan: 'free', source: Number.isFinite(trialExpiry) ? 'expired-trial' : 'free' }
}

/**
 * What the Pulse feed can still deliver for one account: the platforms a weekly
 * run could query today, and when a comp or trial stops. `platforms: 0` means no
 * new weeks can arrive for that brand — the replay's "not enough weeks" line is
 * then a data-dead-end, not just early.
 */
export function feedForAccount(account, now = new Date()) {
  const { plan, source } = resolveFeedEntitlement(account, now)
  const platforms = pulsePlatformsFor(PLAN_CATALOG[plan].features.platform_access).length
  const raw = source === 'override' ? account?.override_expires_at : source === 'trial' ? account?.trial_ends_at : null
  return { plan, source, platforms, endsAt: raw === null || raw === undefined ? null : new Date(raw).toISOString() }
}

/** Group weekly rows into brand → month (the week's calendar month) → platform → readings. */
export function groupRows(rows) {
  const byBrandMonth = new Map()
  for (const row of rows) {
    const brand = `${row.brand_name ?? row.client_id}|${row.client_id}`
    const month = String(row.week).slice(0, 7)
    const key = `${brand}|${month}`
    const entry = byBrandMonth.get(key) ?? { brand: row.brand_name ?? row.client_id, clientId: row.client_id, month, platforms: new Map() }
    const readings = entry.platforms.get(row.platform) ?? []
    readings.push({ week: String(row.week), sov: row.sov, answers: row.answers })
    entry.platforms.set(row.platform, readings)
    byBrandMonth.set(key, entry)
  }
  return [...byBrandMonth.values()].sort((left, right) =>
    left.brand.localeCompare(right.brand) || left.month.localeCompare(right.month))
}

/** The longest run of consecutive calendar weeks in a platform's series. */
export function longestConsecutiveRun(readings) {
  const weeks = [...new Set(readings.map(reading => reading.week))].sort().map(weekIndex)
  let best = 0, run = 0
  for (let index = 0; index < weeks.length; index += 1) {
    run = index > 0 && weeks[index] - weeks[index - 1] === 7 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** What the replay says for one brand-month, per platform, plus whether Q1 can be judged yet. */
export function replayMonth(entry, snapshots = []) {
  const opening = snapshots.filter(s => s.month === entry.month && s.kind === 'opening').flatMap(s => s.platforms ?? [])
  const closing = snapshots.filter(s => s.month === entry.month && s.kind === 'closing').flatMap(s => s.platforms ?? [])
  const platforms = [...entry.platforms.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([platform, readings]) => ({
    platform,
    weeks: readings.length,
    longestRun: longestConsecutiveRun(readings),
    ...decideMovement(readings),
  }))
  const visibility = buildVisibility({
    weeks: [...entry.platforms.entries()].flatMap(([platform, readings]) => readings.map(reading => ({ platform, ...reading }))),
    opening, closing,
  })
  return {
    brand: entry.brand, clientId: entry.clientId, month: entry.month,
    readyForQ1: platforms.some(p => p.longestRun >= MOVEMENT_MIN_WEEKS),
    platforms, visibility,
  }
}

async function main() {
  const json = process.argv.includes('--json')
  const sql = neon(process.env.DATABASE_URL)
  const weeks = await sql`
    select c.brand_name, s.client_id, s.platform, s.scan_week::text as week,
           s.sov_score::float8 as sov, s.total_queries::int as answers
    from pulse_weekly_summary s join clients c on c.id = s.client_id
    where s.platform is not null order by s.client_id, s.scan_week, s.platform`
  const snapshots = await sql`
    select client_id, month::text as month, kind, figures->'pulse' as pulse
    from brand_month_snapshots order by month`
  const snapshotRows = []
  for (const row of snapshots) {
    const pulse = row.pulse
    const platforms = pulse?.state === 'ok' && Array.isArray(pulse.platforms)
      ? pulse.platforms.map(platform => ({ platform: platform.platform, sovScore: platform.sovScore })) : []
    snapshotRows.push({ client_id: String(row.client_id), month: String(row.month), kind: row.kind, platforms })
  }
  const entries = groupRows(weeks).map(entry => replayMonth(entry, snapshotRows.filter(s => s.client_id === entry.clientId)))
  // The feed's side of the same question: a month with too few weeks may still
  // be growing, or it may be all the weeks that will ever exist. This reads the
  // accounts behind the brands above, not every brand in the database.
  const accounts = await sql`
    select c.id, c.brand_name, a.plan, a.status, a.stripe_subscription_id,
           a.trial_ends_at::text as trial_ends_at,
           a.override_plan, a.override_expires_at::text as override_expires_at
    from clients c join accounts a on a.id = c.account_id`
  const accountsById = new Map(accounts.map(row => [String(row.id), row]))
  const feed = [...new Map(entries.map(entry => [entry.clientId, accountsById.get(entry.clientId)])).entries()]
    .map(([clientId, account]) => ({ clientId, brand: account?.brand_name ?? clientId, ...feedForAccount(account) }))
    .sort((left, right) => left.brand.localeCompare(right.brand))
  const summary = {
    ruleVersion: (await import('../lib/monthly-report/movement.ts')).MOVEMENT_RULE_VERSION,
    thresholds: { minWeeks: MOVEMENT_MIN_WEEKS, minAnswersPerWeek: MOVEMENT_MIN_ANSWERS_PER_WEEK, weekWindow: MOVEMENT_WEEK_WINDOW },
    brandMonths: entries.length,
    readyForQ1: entries.filter(entry => entry.readyForQ1).length,
    verdicts: entries.reduce((total, entry) => total + entry.platforms.filter(p => p.direction !== null).length, 0),
    feed,
  }
  if (json) { console.log(JSON.stringify({ summary, entries }, null, 1)); return }
  console.log(`movement rule v${summary.ruleVersion} · thresholds ${JSON.stringify(summary.thresholds)}`)
  console.log(`${summary.brandMonths} brand-month(s), ${summary.readyForQ1} with four consecutive weeks, ${summary.verdicts} platform verdict(s)`)
  for (const entry of entries) {
    console.log(`\n${entry.brand} · ${entry.month}${entry.readyForQ1 ? '' : '  (not enough consecutive weeks for Q1 yet)'}`)
    for (const platform of entry.platforms) {
      const verdict = platform.direction ? platform.direction.toUpperCase() : `no direction (${platform.reason})`
      console.log(`  ${platform.platform}: ${platform.weeks} week(s), longest run ${platform.longestRun}, ${verdict}`)
    }
    console.log(`  report visibility: ${entry.visibility.state === 'recorded'
      ? `${entry.visibility.platforms.length} platform row(s)` : entry.visibility.reason}`)
  }
  if (feed.length) {
    console.log('\nPulse data feed for the brands above (can these weeks still grow?):')
    for (const brand of feed) {
      const ends = brand.endsAt ? ` until ${brand.endsAt.slice(0, 10)}` : ''
      console.log(`  ${brand.brand}: ${brand.plan} via ${brand.source}${ends}, ${brand.platforms} Pulse platform(s)`)
    }
    const starved = feed.filter(brand => brand.platforms === 0)
    if (starved.length) {
      console.log(`\nWARNING: ${starved.map(brand => brand.brand).join(', ')} cannot collect new Pulse weeks`
        + ` (${starved.map(brand => `${brand.plan} via ${brand.source}`).join('; ')}): no platform is granted,`
        + ' so the weeks above are all this pipeline will record unless the account is entitled again.')
    }
  }
  if (!summary.readyForQ1) {
    console.log('\nQ1 cannot be judged from this data yet: no platform has four consecutive weekly readings inside one month.')
    console.log('The first month that does is when this replay becomes a decision; until then the rule correctly claims no movement.')
  }
}

if (process.argv[1] && process.argv[1].endsWith('replay-movement-rule.mjs')) {
  main().catch(error => { console.error(`movement replay: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
