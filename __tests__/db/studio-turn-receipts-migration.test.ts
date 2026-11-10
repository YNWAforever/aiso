import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/105_studio_turn_receipts.sql', 'utf8')

it('adds server-composition receipts and an idempotency key to studio turns', () => {
  expect(sql).toMatch(/alter table studio_thread_turns/i)
  expect(sql).toMatch(/add column if not exists receipts jsonb/i)
  expect(sql).toMatch(/add column if not exists request_id uuid/i)
  // Receipts stay a bounded array, never an unbounded free-form blob.
  expect(sql).toMatch(/jsonb_typeof\(receipts\)\s*=\s*'array'/i)
  expect(sql).toMatch(/octet_length\(receipts::text\)\s*<=\s*32768/i)
})

it('makes one append per thread and request id, and leaves legacy rows untouched', () => {
  expect(sql).toMatch(/create unique index if not exists studio_thread_turns_request_key\s+on studio_thread_turns \(thread_id, request_id\)\s+where request_id is not null/i)
  // Both columns are nullable on purpose: pre-B1 turns are not an empty receipt list.
  expect(sql).toMatch(/receipts is null or/i)
  expect(sql).not.toMatch(/not null default/i)
})

it('does not add a schedule, a policy or a new grant', () => {
  expect(sql).not.toMatch(/cron|pg_cron|create policy|grant /i)
})
