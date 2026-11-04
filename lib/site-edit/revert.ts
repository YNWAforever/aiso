import 'server-only'
import { db } from '@/lib/db'
import type { EditSpecV1 } from './edit-spec'

/**
 * Site-edit S5: a revert (`jsonld_remove`) may only remove a block AISO's own
 * review approved adding. True when the spec is an add, or when an APPROVED
 * version of this same work item, in this account, carries an add spec with
 * exactly this target, schema type and payload (jsonb equality, so key order
 * is irrelevant). Approvals are append-only, so this pre-check cannot go stale.
 */
export async function revertHasApprovedSource(accountId: string, clientId: string, itemId: string, spec: EditSpecV1): Promise<boolean> {
  if (spec.kind !== 'jsonld_remove') return true
  const add = JSON.stringify({ ...spec, kind: 'jsonld' })
  const rows = await db()`
    SELECT 1 FROM work_item_versions v
    JOIN work_item_decisions r ON r.account_id = v.account_id AND r.client_id = v.client_id AND r.work_item_id = v.work_item_id
      AND r.version_id = v.id AND r.content_hash = v.content_hash AND r.decision = 'approved'
    WHERE v.account_id = ${accountId}::uuid AND v.client_id = ${clientId}::uuid AND v.work_item_id = ${itemId}::uuid
      AND v.content->'editSpec' = ${add}::jsonb
    LIMIT 1`
  return rows.length === 1
}
