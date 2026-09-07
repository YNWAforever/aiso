import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const file = 'supabase/migrations/043_delivery_attestations.sql'
const sql = () => existsSync(file) ? readFileSync(file, 'utf8').toLowerCase().replace(/\s+/g, ' ') : ''
it('creates immutable delivery events with server defaults', () => {
  expect(sql()).toContain('create table public.work_item_delivery_events')
  for (const clause of ['id uuid primary key default gen_random_uuid()', 'schema_version integer not null default 1', 'recorded_at timestamptz not null default clock_timestamp()']) expect(sql()).toContain(clause)
})
it('binds exact owner, version hash and approved decision tuples', () => {
  expect(sql()).toContain('on public.work_item_decisions (account_id, client_id, work_item_id, version_id, content_hash, id, decision)')
  expect(sql()).toContain('references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash) on delete restrict')
  expect(sql()).toContain('foreign key (account_id, client_id, work_item_id, version_id, content_hash, approval_decision_id, approval_decision)')
  expect(sql()).toContain("approval_decision = 'approved'")
})
it('binds withdrawal to same-scope attestations and deduplicates requests and targets', () => {
  expect(sql()).toContain('unique (account_id, client_id, work_item_id, version_id, content_hash, id, kind)')
  expect(sql()).toContain('foreign key (account_id, client_id, work_item_id, version_id, content_hash, target_attestation_id, target_kind)')
  expect(sql()).toContain("target_kind = 'attest'")
  expect(sql()).toContain('unique (target_attestation_id)')
  expect(sql()).toContain('unique (account_id, actor_id, request_id)')
})
it('closes NULL kind/actor bypasses and enforces kind-specific fields and text bounds', () => {
  for (const clause of ['delivery_attest_check check ((', 'delivery_withdraw_check check ((', 'delivery_actor_check check ((', ') is true)', 'delivered_at <= recorded_at', 'reason is null', 'destination is null', 'approval_decision_id is null', 'target_attestation_id <> id', "actor->>'profileid' = actor_id::text", "actor->>'role' = 'account_member'", 'between 1 and 500', 'between 1 and 2000', 'normalize(destination, nfc)', 'normalize(note, nfc)', 'normalize(reason, nfc)']) expect(sql()).toContain(clause)
})
it('revokes inherited history writes and preserves deleted actors and parents', () => {
  expect(sql()).toContain('revoke all on public.work_item_delivery_events from public')
  expect(sql()).toContain('revoke all on public.work_item_delivery_events from aeo_app')
  expect(sql()).toContain('grant select, insert on public.work_item_delivery_events to aeo_app')
  expect(sql()).not.toMatch(/on delete cascade|references (?:public\.)?profiles|grant[^;]*(?:update|delete|truncate)/)
})
