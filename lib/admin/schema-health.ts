import { db } from '@/lib/db'

// Bounded diagnostics for the recent 063–070 release. This is not migration
// equivalence, a grants audit, or a claim that a feature/provider works.
const REQUIREMENTS = {
  onboarding: ['onboarding_progress.request_hash', 'onboarding_progress.request_aliases'],
  monitoring: ['pulse_runs.purpose', 'pulse_runs.intent_key', 'pulse_runs.source_run_id', 'pulse_user_intents.request_hash', 'pulse_run_reservations.reserved_units'],
  evidence: ['pulse_metrics.search_evidence', 'pulse_item_attempts.search_evidence', 'pulse_item_attempts.grounding', 'pulse_classification_attempts.usage', 'pulse_legacy_classification_attempts.answer_hash'],
  questions: ['prompt_batch_intents.result'],
  work: ['work_item_groups.scope_snapshot', 'evidence_work_items.target_url', 'evidence_work_items.owner_id', 'evidence_work_items.due_at', 'evidence_work_items.acceptance_criteria', 'evidence_work_items.operation_status'],
} as const
export type SchemaHealth = {
  status: 'columns_present' | 'attention' | 'unavailable'; checkedAt: string;
  checks: { key: keyof typeof REQUIREMENTS; missing: string[] }[];
}

/** Only call behind the platform-admin guard. No tenant/customer rows or DDL.
 * information_schema exposes columns visible to the actual app role: absent OR
 * inaccessible columns need investigation; neither is treated as healthy.
 */
export async function readAdminSchemaHealth(): Promise<SchemaHealth> {
  const checkedAt = new Date().toISOString()
  try {
    const tables = [...new Set(Object.values(REQUIREMENTS).flat().map(column => column.split('.')[0]))]
    const sql = db()
    const columns = await sql`select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any(${tables}::text[])`
    const present = new Set(columns.map(column => `${column.table_name}.${column.column_name}`))
    const checks = (Object.keys(REQUIREMENTS) as (keyof typeof REQUIREMENTS)[]).map(key => ({
      key, missing: REQUIREMENTS[key].filter(column => !present.has(column)),
    }))
    return { status: checks.some(check => check.missing.length) ? 'attention' : 'columns_present', checkedAt, checks }
  } catch {
    // Driver failures may include connection strings. Never serialize/log them.
    return { status: 'unavailable', checkedAt, checks: [] }
  }
}
