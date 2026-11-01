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
