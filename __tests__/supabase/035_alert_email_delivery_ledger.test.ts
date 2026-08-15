import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/035_alert_email_delivery_ledger.sql'),
  'utf8',
)

describe('035_alert_email_delivery_ledger.sql', () => {
  it('keys the ledger so one email can be sent per client, type and week', () => {
    expect(migrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.alert_email_deliveries/i,
    )
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS alert_email_deliveries_dedup_idx\s+ON public\.alert_email_deliveries\s*\(\s*client_id,\s*type,\s*scan_week\s*\);/si,
    )
  })

  it('constrains type to the three alert types the evaluator emits', () => {
    // Same three the notifications CHECK allows (010_phase3b.sql:32). A fourth
    // alert type has to be added in both places or the ledger insert throws
    // after the notification insert has already succeeded.
    expect(migrationSql).toMatch(
      /CHECK \(type IN \('sov_threshold', 'sov_wow_drop', 'sov_recovery'\)\)/i,
    )
  })

  it('cascades with the client, so deleting a brand cannot strand ledger rows', () => {
    expect(migrationSql).toMatch(
      /client_id\s+uuid NOT NULL REFERENCES public\.clients\(id\) ON DELETE CASCADE/i,
    )
  })

  it('types scan_week and recipient so the evaluator cannot widen or drop them silently', () => {
    // scan_week must stay a real date -- the evaluator writes '2026-08-08'-shaped
    // strings -- and recipient must stay required, or a later edit widening
    // scan_week to text or dropping NOT NULL passes this suite silently.
    expect(migrationSql).toMatch(/scan_week\s+date NOT NULL/i)
    expect(migrationSql).toMatch(/recipient\s+text NOT NULL/i)
  })

  it('uses nothing Neon does not have', () => {
    // 027 had to be rewritten because it granted to the Supabase roles
    // anon / authenticated / service_role and called gen_random_bytes()
    // without enabling pgcrypto. None of those exist under Neon.
    // gen_random_uuid() is core PostgreSQL 13+ and is fine.
    expect(migrationSql).not.toMatch(
      /\bGRANT\b|\bREVOKE\b|\banon\b|\bauthenticated\b|\bservice_role\b|gen_random_bytes/i,
    )
  })
})
