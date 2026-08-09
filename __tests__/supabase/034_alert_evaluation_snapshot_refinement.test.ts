import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/034_alert_evaluation_snapshot_refinement.sql'),
  'utf8',
)

describe('034_alert_evaluation_snapshot_refinement.sql', () => {
  it('rebuilds only the refined weekly snapshot index', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX IF EXISTS public\.pulse_weekly_summary_alert_snapshot_idx;/si,
    )
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx\s+ON public\.pulse_weekly_summary\s*\(\s*client_id,\s*scan_week DESC,\s*created_at DESC NULLS LAST,\s*id DESC\s*\)\s+WHERE platform IS NULL;/si,
    )
    expect(migrationSql).not.toMatch(
      /get_alert_weekly_snapshot|CREATE OR REPLACE FUNCTION|SECURITY DEFINER|SET search_path|\bGRANT\b|\bREVOKE\b|\banon\b|\bauthenticated\b|\bservice_role\b/i,
    )
  })
})
