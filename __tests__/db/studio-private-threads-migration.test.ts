import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/081_studio_private_threads.sql', 'utf8')

it('creates principal-scoped threads with composite tenancy foreign keys', () => {
  expect(migration).toContain('create table if not exists studio_threads')
  expect(migration).toMatch(/id uuid primary key default gen_random_uuid\(\)/i)
  expect(migration).toMatch(/account_id uuid not null references accounts\(id\) on delete cascade/i)
  expect(migration).toMatch(/kind text not null check \(kind in \('research', 'brief'\)\)/i)
  expect(migration).toMatch(/title text not null check \(char_length\(title\) between 1 and 200\)/i)
  expect(migration).toMatch(/goal text not null check \(char_length\(goal\) between 1 and 1000\)/i)
  expect(migration).toMatch(/unique \(id, account_id, client_id, profile_id\)/i)
  expect(migration).toMatch(/foreign key \(client_id, account_id\) references clients\(id, account_id\) on delete cascade/i)
  expect(migration).toMatch(/foreign key \(profile_id, account_id\) references profiles\(id, account_id\)/i)
  expect(migration).toMatch(/studio_threads \(account_id, client_id, profile_id, updated_at desc, id desc\)/i)
})

it('keeps turns ordered, capped and bound to the parent principal', () => {
  expect(migration).toContain('create table if not exists studio_thread_turns')
  expect(migration).toMatch(/position integer not null check \(position >= 0\)/i)
  expect(migration).toMatch(/unique \(thread_id, position\)/i)
  expect(migration).toMatch(/prompt text not null check \(char_length\(prompt\) between 1 and 1000\)/i)
  expect(migration).toMatch(/reply jsonb not null check \(jsonb_typeof\(reply\) = 'object' and octet_length\(reply::text\) <= 65536\)/i)
  expect(migration).toMatch(/attached jsonb check \(attached is null or \(jsonb_typeof\(attached\) = 'object' and octet_length\(attached::text\) <= 4096\)\)/i)
  expect(migration).toMatch(/live jsonb check \(live is null or \(jsonb_typeof\(live\) = 'object' and octet_length\(live::text\) <= 65536\)\)/i)
  expect(migration).toMatch(/foreign key \(thread_id, account_id, client_id, profile_id\)\s+references studio_threads\(id, account_id, client_id, profile_id\) on delete cascade/i)
})

it('keeps both tables closed to the Data API with no policies', () => {
  expect(migration).toMatch(/alter table studio_threads enable row level security/i)
  expect(migration).toMatch(/alter table studio_thread_turns enable row level security/i)
  expect(migration).toMatch(/revoke all on studio_threads, studio_thread_turns from public/i)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expect(migration).toContain(`if to_regrole('${role}') is not null then`)
    expect(migration).toContain(`revoke all on studio_threads, studio_thread_turns from ${role}`)
  }
  expect(migration).not.toMatch(/create policy|auth\.uid\(\)/i)
})
