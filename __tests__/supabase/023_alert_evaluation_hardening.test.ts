import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/023_alert_evaluation_hardening.sql'),
  'utf8',
)

describe('023_alert_evaluation_hardening.sql', () => {
  it('deduplicates aggregate rows before ranking the latest two distinct scan weeks per client', () => {
    expect(migrationSql).toMatch(
      /DISTINCT ON\s*\(\s*summary\.client_id,\s*summary\.scan_week\s*\)/si,
    )
    expect(migrationSql).toMatch(
      /ORDER BY\s+summary\.client_id,\s*summary\.scan_week DESC,\s*summary\.id DESC/si,
    )
    expect(migrationSql).toMatch(
      /row_number\(\)\s+OVER\s*\(\s*PARTITION BY latest_distinct_weeks\.client_id\s+ORDER BY latest_distinct_weeks\.scan_week DESC\s*\)\s+AS row_number/si,
    )
    expect(migrationSql).toMatch(
      /FROM ranked\s+WHERE ranked\.row_number <= 2\s+ORDER BY ranked\.client_id,\s*ranked\.row_number ASC;/si,
    )
  })
})
