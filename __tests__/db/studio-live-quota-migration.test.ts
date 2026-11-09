import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/080_studio_live_weekly_usage.sql', 'utf8')

it('stores one answer count per account and UTC week', () => {
  expect(migration).toContain('studio_live_weekly_usage')
  expect(migration).toMatch(/account_id uuid not null references accounts\(id\) on delete cascade/i)
  expect(migration).toMatch(/week_start date not null/i)
  expect(migration).toMatch(/answer_count integer not null check \(answer_count >= 0\)/i)
  expect(migration).toMatch(/primary key \(account_id, week_start\)/i)
})

it('keeps the durable counter closed to the Data API', () => {
  expect(migration).toMatch(/enable row level security/i)
  expect(migration).toMatch(/revoke all on studio_live_weekly_usage from public/i)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expect(migration).toContain(`if to_regrole('${role}') is not null then`)
    expect(migration).toContain(`revoke all on studio_live_weekly_usage from ${role}`)
  }
  expect(migration).not.toMatch(/create policy|auth\.uid\(\)/i)
})

const perBrand = readFileSync('supabase/migrations/102_studio_live_quota_per_brand.sql', 'utf8')

it('meets the 2026-11-09 rule: one brand (single site) counts per UTC week', () => {
  // Product rule: at most 10 LIVE answers per brand per week, enforced by a
  // counter that cannot be shared between brands or attributed to an account.
  expect(perBrand).toMatch(/delete from studio_live_weekly_usage;/i)
  expect(perBrand).toMatch(/add column if not exists client_id uuid/i)
  expect(perBrand).toMatch(/alter column client_id set not null/i)
  expect(perBrand).toMatch(/primary key \(account_id, client_id, week_start\)/i)
  expect(perBrand).toMatch(/foreign key \(client_id, account_id\) references clients \(id, account_id\) on delete cascade/i)
  // A counter row cannot outlive or cross its brand.
  expect(perBrand).not.toMatch(/create policy|auth\.uid\(\)/i)
})

it('documents that the cap lives in code and nothing scans on a schedule', () => {
  expect(perBrand).toMatch(/STUDIO_LIVE_ANSWERS_PER_BRAND_PER_WEEK/)
  expect(perBrand).toMatch(/nothing scans a site on a schedule/i)
})
