import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/104_studio_thread_branch.sql', 'utf8')

/**
 * Branch lineage (conversation-workspace design, Phase A): a thread records the
 * message it branched from. The pair is brand-scoped and cannot point across
 * tenants; no turns are copied.
 */
it('adds a brand-scoped origin pair and its identity keys', () => {
  expect(migration).toMatch(/add column if not exists branched_from_thread_id uuid/)
  expect(migration).toMatch(/add column if not exists branched_from_turn_id uuid/)
  expect(migration).toMatch(/studio_threads_id_account_client_key unique \(id, account_id, client_id\)/)
  expect(migration).toMatch(/studio_thread_turns_id_thread_key unique \(id, thread_id\)/)
  expect(migration).toMatch(/studio_threads_branch_origin_fkey/)
  expect(migration).toMatch(/studio_threads_branch_turn_fkey/)
})

it('keeps the pair atomic and never self-referential', () => {
  expect(migration).toMatch(/studio_threads_branch_pair_check/)
  expect(migration).toMatch(/studio_threads_branch_no_self_check/)
  // A strict pair CHECK would block the origin-turn cascade unless both ids clear
  // together, so the turn FK must null the pair.
  expect(migration).toMatch(/on delete set null \(branched_from_turn_id, branched_from_thread_id\)/)
})

it('schedules nothing', () => {
  expect(migration).not.toMatch(/create policy|auth\.uid\(\)/i)
  expect(migration).toMatch(/Nothing here schedules anything/i)
})
