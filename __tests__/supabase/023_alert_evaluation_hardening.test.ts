import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/023_alert_evaluation_hardening.sql'),
  'utf8',
)

describe('023_alert_evaluation_hardening.sql', () => {
  it('keeps the original bounded snapshot index and initial latest-two-weeks RPC shape', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX IF EXISTS public\.notifications_dedup_idx;/si,
    )
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx\s+ON public\.notifications\s*\(\s*client_id,\s*type,\s*scan_week\s*\);/si,
    )
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx\s+ON public\.pulse_weekly_summary\s*\(\s*client_id,\s*scan_week DESC,\s*id DESC\s*\)\s+WHERE platform IS NULL;/si,
    )
    expect(migrationSql).toMatch(
      /row_number\(\)\s+OVER\s*\(\s*PARTITION BY summary\.client_id\s+ORDER BY summary\.scan_week DESC,\s*summary\.id DESC\s*\)\s+AS row_number/si,
    )
    expect(migrationSql).toMatch(
      /FROM ranked\s+WHERE ranked\.row_number <= 2\s+ORDER BY ranked\.client_id,\s*ranked\.scan_week DESC;/si,
    )
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_alert_weekly_snapshot\(uuid\[\]\) TO service_role;/si,
    )
  })
})
