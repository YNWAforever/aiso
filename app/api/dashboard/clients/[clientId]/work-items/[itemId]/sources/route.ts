import { authorizeAssetRegistry } from '@/lib/assets/guard'
import { multiSourceEnabled } from '@/lib/work-items/multi-source-flag'
import { loadOwnedDraftSource, readOwnedDraft } from '@/lib/work-items/store'
import { attachSource, listLiveSources, withdrawSource } from '@/lib/work-items/sources'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import type { OpportunitySourceKind, SourceRef } from '@/lib/opportunities/types'
import type { EvidenceCheckKey } from '@/lib/scan-evidence'

export const dynamic = 'force-dynamic'

/**
 * Attach a second (or later) source to an existing work item, or withdraw one.
 *
 * Gated like the sibling asset routes (`authorizeAssetRegistry`: session only,
 * no entitlement check — attaching evidence you already own spends no model
 * budget) and additionally by `multiSourceEnabled`. With the flag off every
 * item still has exactly one source by the pre-051 rule, so this route
 * reports 404, the same as if it did not exist.
 *
 * The caller's only handle is `opportunityKey` — the same string
 * `work_item_sources.opportunity_key` stores, and it fully determines
 * `ruleVersion` and the source ref it was built from
 * (`lib/opportunities/fingerprint.ts`'s `opportunityKey` joins them with `:`,
 * and none of the parts can contain one). Parsing it back is what lets POST
 * re-derive the source exactly as `saveAuthenticatedDraft` does —
 * `loadOwnedDraftSource` then `deriveSuggestions(...).find(...)` — and refuse
 * with 409 when it no longer derives. Attaching without that step would
 * recreate the provenance lie migrations 041-046 exist to prevent.
 *
 * Withdrawal needs none of this: it only ever marks an existing row by its
 * already-attached opportunity_key, so DELETE passes the key straight to
 * withdrawSource without parsing it.
 */

type Body = { opportunityKey?: unknown }

async function readKey(req: Request): Promise<string | null> {
  let body: Body
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    body = parsed
  } catch {
    return null
  }
  const key = typeof body.opportunityKey === 'string' ? body.opportunityKey.trim() : ''
  return key || null
}

const SOURCE_KINDS: readonly OpportunitySourceKind[] = ['pulse-metric', 'scan-check', 'agent-recommendation']

function parseOpportunityKey(key: string): { ruleVersion: string; source: SourceRef } | null {
  const parts = key.split(':')
  if (parts.length !== 4) return null
  const [ruleVersion, kind, id, checkKey] = parts
  if (!ruleVersion || !id) return null
  if (!SOURCE_KINDS.includes(kind as OpportunitySourceKind)) return null
  return {
    ruleVersion,
    source: { kind: kind as OpportunitySourceKind, id, ...(checkKey ? { checkKey: checkKey as EvidenceCheckKey } : {}) },
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string; itemId: string }> },
) {
  const access = await authorizeAssetRegistry()
  if (!access.ok) return access.response
  if (!multiSourceEnabled()) return Response.json({ error: 'Not found' }, { status: 404 })
  const { clientId, itemId } = await params

  const opportunityKey = await readKey(req)
  if (!opportunityKey) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const parsedKey = parseOpportunityKey(opportunityKey)
  if (!parsedKey) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const item = await readOwnedDraft(access.accountId, clientId, itemId)
    if (!item) return Response.json({ error: 'Not found' }, { status: 404 })

    const selected = await loadOwnedDraftSource(access.accountId, clientId, parsedKey.source)
    const suggestion = selected && deriveSuggestions(selected.source).find(candidate => candidate.key === opportunityKey)
    if (!selected || !suggestion) return Response.json({ error: 'Evidence changed' }, { status: 409 })

    let snapshot
    try {
      snapshot = buildInitialDraftSnapshot(suggestion, selected.source, item.locale)
    } catch {
      return Response.json({ error: 'Evidence changed' }, { status: 409 })
    }

    const attached = await attachSource({
      accountId: access.accountId,
      clientId,
      workItemId: itemId,
      source: {
        opportunityKey,
        sourceKind: suggestion.source.kind,
        sourceId: suggestion.source.id,
        ruleVersion: suggestion.ruleVersion,
        checkKey: suggestion.source.checkKey ?? null,
        fingerprint: suggestion.fingerprint,
        snapshot,
      },
      actorId: access.actorId,
    })
    if (!attached) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ attached: true })
  } catch (error) {
    // A 2xx over a failed write is the mistake this codebase has paid for once
    // already: the Stripe webhook returned ok while dropping every write.
    console.error('[work-items] attach source failed:', error)
    return Response.json({ error: 'Attach failed' }, { status: 503 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ clientId: string; itemId: string }> },
) {
  const access = await authorizeAssetRegistry()
  if (!access.ok) return access.response
  if (!multiSourceEnabled()) return Response.json({ error: 'Not found' }, { status: 404 })
  const { clientId, itemId } = await params

  const opportunityKey = await readKey(req)
  if (!opportunityKey) return Response.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const withdrawn = await withdrawSource({
      accountId: access.accountId, clientId, workItemId: itemId, opportunityKey, actorId: access.actorId,
    })
    if (withdrawn) return Response.json({ withdrawn: true })

    // Zero rows means: absent, not yours, already withdrawn, or the only live
    // source — withdrawSource cannot distinguish them from its return value
    // alone. listLiveSources tells the last case apart: if the key is still
    // live, the rule refused it, which is a conflict, not a missing source.
    const live = await listLiveSources(access.accountId, clientId, itemId)
    const stillLive = live.some(source => source.opportunityKey === opportunityKey)
    if (stillLive) return Response.json({ error: 'Cannot withdraw the only source' }, { status: 409 })
    return Response.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    console.error('[work-items] withdraw source failed:', error)
    return Response.json({ error: 'Withdrawal failed' }, { status: 503 })
  }
}
