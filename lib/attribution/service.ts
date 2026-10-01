import 'server-only'
import { isAnalyticsEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { ProfileWithAccount } from '@/lib/types'
import { compareTarget } from './compare'
import { loadAttributionInput, type AttributionSources, type MeasuredTarget } from './store'
import type { TargetResult } from './types'
import { deliveryDay, hkToday, readyOn, windowsFor, type DayRange } from './windows'

/**
 * The GET body (spec §5.2). Called only after authorizeAttribution has passed,
 * with the account it resolved from the session.
 *
 * One row per measured target of the version's newest attestation. Two shapes
 * have no measured target to hang a status on, and get a single row with
 * `scope: null` instead, so the status still reaches the owner: an active
 * attestation that measured nothing (`not_measured`, "re-record to measure"),
 * or a multi-source version that measured nothing (`not_supported`).
 * A version never attested has no rows at all, and a withdrawn attestation keeps
 * its targets (each `withdrawn`) but no delivery date: it is not a delivery any more.
 */

export type AttributionTarget = TargetResult & {
  scope: 'site' | 'page' | null
  asset?: { id: string; url: string; label: string }
}

export type AttributionResponse = {
  deliveredOn: string | null
  windows: { before: DayRange; after: DayRange } | null
  readyOn: string | null
  targets: AttributionTarget[]
}

const headers = { 'Cache-Control': 'private, no-store' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })

/** A store result the service cannot honestly render. Answered 503, never as a quieter status. */
class InconsistentInput extends Error {
  constructor() {
    super('attribution input inconsistent')
    this.name = 'AttributionInputInconsistent'
  }
}

function row(target: MeasuredTarget | null, result: TargetResult): AttributionTarget {
  return {
    scope: target?.scope ?? null,
    ...(target?.asset ? { asset: target.asset } : {}),
    ...result,
  }
}

function measure(
  target: MeasuredTarget,
  sources: AttributionSources,
  base: { day: string; today: string; schemaVersion: number },
  analytics: boolean,
): TargetResult {
  const pageUrl = target.asset?.url ?? null
  const scope = target.scope === 'site' ? 'property' : 'page'
  const mine = <T extends { scope: string; pageUrl: string | null }>(r: T) => r.scope === scope && r.pageUrl === pageUrl

  let enquiries: Parameters<typeof compareTarget>[0]['enquiries'] = null
  if (target.scope === 'site') {
    if (!analytics) enquiries = { enabled: false, state: null, days: [] }
    else if (!sources.enquiries) throw new InconsistentInput()
    else enquiries = { enabled: true, state: sources.enquiries.state, days: sources.enquiries.days }
  }

  return compareTarget({
    ...base,
    withdrawn: false,
    measured: true,
    scope: target.scope,
    pageSynced: target.synced,
    search: sources.search
      ? { ...sources.search, coveredFrom: sources.coverage.find(mine)?.coveredFrom ?? null }
      : null,
    searchDays: sources.searchDays.filter(mine),
    enquiries,
  })
}

export async function getAttribution(
  gate: { profile: ProfileWithAccount; accountId: string },
  clientId: string,
  itemId: string,
  versionId: string,
): Promise<Response> {
  // Enquiries need GA4 switched on AND in the plan, on top of attribution's own gate.
  const analytics = isAnalyticsEnabled() && resolveCommercialEntitlement(gate.profile.accounts).features.analytics

  let body: AttributionResponse
  try {
    const input = await loadAttributionInput(gate.accountId, clientId, itemId, versionId, { analytics })
    if (!input) return json({ error: 'Not found' }, 404)

    const { attestation, measures, schemaVersion } = input
    if (!attestation) {
      body = { deliveredOn: null, windows: null, readyOn: null, targets: [] }
    } else {
      const day = deliveryDay(attestation.deliveredAt)
      const base = { day, today: hkToday(new Date()), schemaVersion }
      // The statuses before any source is read (withdrawn, not_supported,
      // not_measured) come from compareTarget too, so their order lives in one place.
      const early = (target: MeasuredTarget | null) => row(target, compareTarget({
        ...base,
        withdrawn: attestation.withdrawn,
        measured: target !== null,
        scope: target?.scope ?? 'page',
        // Never reached: every early status returns before the sync set matters.
        pageSynced: target?.synced ?? true,
        search: null,
        searchDays: [],
        enquiries: null,
      }))

      let targets: AttributionTarget[]
      if (measures.length === 0) targets = [early(null)]
      else if (attestation.withdrawn || schemaVersion !== 1) targets = measures.map(early)
      // Measured, live and supported, yet no sources read: rendering it would
      // show "not bound" over a store bug.
      else if (!input.sources) throw new InconsistentInput()
      else {
        const sources = input.sources
        targets = measures.map(target => row(target, measure(target, sources, base, analytics)))
      }
      body = attestation.withdrawn
        ? { deliveredOn: null, windows: null, readyOn: null, targets }
        : { deliveredOn: day, windows: windowsFor(day), readyOn: readyOn(day), targets }
    }
  } catch (err) {
    // The name only: the Neon driver's messages carry the connection string.
    console.error('attribution: read failed', { name: err instanceof Error ? err.name : 'unknown' })
    return json({ error: 'Unavailable' }, 503)
  }
  return json(body)
}
