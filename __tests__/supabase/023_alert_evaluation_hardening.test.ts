import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/023_alert_evaluation_hardening.sql'),
  'utf8',
)

describe('023_alert_evaluation_hardening.sql', () => {
  it('creates only the notification deduplication and initial snapshot indexes', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX IF EXISTS public\.notifications_dedup_idx;/si,
    )
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx\s+ON public\.notifications\s*\(\s*client_id,\s*type,\s*scan_week\s*\);/si,
    )
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx\s+ON public\.pulse_weekly_summary\s*\(\s*client_id,\s*scan_week DESC,\s*id DESC\s*\)\s+WHERE platform IS NULL;/si,
    )
    expect(migrationSql).not.toMatch(
      /get_alert_weekly_snapshot|CREATE OR REPLACE FUNCTION|SECURITY DEFINER|SET search_path|\bGRANT\b|\bREVOKE\b|\banon\b|\bauthenticated\b|\bservice_role\b/i,
    )
  })
})
