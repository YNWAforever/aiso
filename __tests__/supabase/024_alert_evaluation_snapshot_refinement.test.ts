import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/024_alert_evaluation_snapshot_refinement.sql'),
  'utf8',
)

describe('024_alert_evaluation_snapshot_refinement.sql', () => {
  it('rebuilds the snapshot index and refines the RPC without changing grants', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX IF EXISTS public\.pulse_weekly_summary_alert_snapshot_idx;/si,
    )
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx\s+ON public\.pulse_weekly_summary\s*\(\s*client_id,\s*scan_week DESC,\s*created_at DESC NULLS LAST,\s*id DESC\s*\)\s+WHERE platform IS NULL;/si,
    )
    expect(migrationSql).toMatch(
      /DISTINCT ON\s*\(\s*summary\.client_id,\s*summary\.scan_week\s*\)/si,
    )
    expect(migrationSql).toMatch(
      /ORDER BY\s+summary\.client_id,\s*summary\.scan_week DESC,\s*summary\.created_at DESC NULLS LAST,\s*summary\.id DESC/si,
    )
    expect(migrationSql).toMatch(
      /row_number\(\)\s+OVER\s*\(\s*PARTITION BY latest_distinct_weeks\.client_id\s+ORDER BY latest_distinct_weeks\.scan_week DESC\s*\)\s+AS row_number/si,
    )
    expect(migrationSql).toMatch(
      /FROM ranked\s+WHERE ranked\.row_number <= 2\s+ORDER BY ranked\.client_id,\s*ranked\.row_number ASC;/si,
    )
    expect(migrationSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_alert_weekly_snapshot\(uuid\[\]\) FROM PUBLIC;/si,
    )
    expect(migrationSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_alert_weekly_snapshot\(uuid\[\]\) FROM anon;/si,
    )
    expect(migrationSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_alert_weekly_snapshot\(uuid\[\]\) FROM authenticated;/si,
    )
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_alert_weekly_snapshot\(uuid\[\]\) TO service_role;/si,
    )
  })
})
