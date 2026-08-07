import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/023_alert_evaluation_hardening.sql'),
  'utf8',
)

describe('023_alert_evaluation_hardening.sql', () => {
  it('keeps ranked weekly snapshot rows in deterministic newest-first order per client', () => {
    expect(migrationSql).toMatch(
      /row_number\(\)\s+OVER\s*\(\s*PARTITION BY summary\.client_id\s+ORDER BY summary\.scan_week DESC,\s*summary\.id DESC\s*\)\s+AS row_number/si,
    )
    expect(migrationSql).toMatch(
      /FROM ranked\s+WHERE ranked\.row_number <= 2\s+ORDER BY ranked\.client_id,\s*ranked\.row_number ASC;/si,
    )
  })
})
