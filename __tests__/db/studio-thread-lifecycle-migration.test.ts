import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/103_studio_thread_lifecycle.sql', 'utf8')

/**
 * Phase A lifecycle (conversation-workspace design §10): threads can be pinned,
 * archived and shared read-only with the brand. The migration only adds facts;
 * every permission stays in the API.
 */
it('adds visibility, pin and archive without changing tenancy', () => {
  expect(migration).toMatch(/add column if not exists visibility text not null default 'private'/i)
  expect(migration).toMatch(/add column if not exists pinned_at timestamptz/i)
  expect(migration).toMatch(/add column if not exists archived_at timestamptz/i)
  expect(migration).toMatch(/check \(visibility in \('private', 'shared'\)\)/i)
  expect(migration).toMatch(/studio_threads_shared_recent_idx/i)
})

it('keeps the closed posture: no policies and no scheduled scans', () => {
  expect(migration).not.toMatch(/create policy|auth\.uid\(\)/i)
  expect(migration).toMatch(/Nothing here schedules or scans anything/i)
})

it('states that staff threads stay private', () => {
  expect(migration).toMatch(/Staff threads \(088\) stay private/i)
})
