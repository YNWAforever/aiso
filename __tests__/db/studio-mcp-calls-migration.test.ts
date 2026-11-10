import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/106_studio_mcp_calls.sql', 'utf8')

it('creates an append-only audit table for internal MCP calls', () => {
  expect(sql).toMatch(/create table if not exists studio_mcp_calls/i)
  for (const column of ['account_id uuid not null', 'client_id uuid not null', 'profile_id uuid not null', 'tool text not null', 'outcome text not null', 'rpc_id text', 'created_at timestamptz not null default now()']) {
    expect(sql).toContain(column)
  }
  // A closed outcome vocabulary, so "allowed/failed/denied" is not free text.
  expect(sql).toMatch(/outcome in \('allowed', 'denied', 'failed'\)/i)
  expect(sql).toMatch(/char_length\(tool\) between 1 and 64/i)
  expect(sql).toMatch(/char_length\(detail\) <= 200/i)
  expect(sql).toMatch(/char_length\(rpc_id\) <= 64/i)
})

it('scopes every row to its brand with a composite tenant FK', () => {
  expect(sql).toMatch(/foreign key \(client_id, account_id\) references public\.clients \(id, account_id\)/i)
  expect(sql).toMatch(/create index if not exists studio_mcp_calls_brand_time_idx\s+on studio_mcp_calls \(account_id, client_id, created_at desc\)/i)
})

it('grants insert-only history to the app role and never stores content', () => {
  expect(sql).toMatch(/revoke all on public\.studio_mcp_calls from public/i)
  expect(sql).toMatch(/revoke all on public\.studio_mcp_calls from aeo_app/i)
  expect(sql).toMatch(/grant select, insert on public\.studio_mcp_calls to aeo_app/i)
  expect(sql).not.toMatch(/grant [^;]*update/i)
  expect(sql).not.toMatch(/grant [^;]*delete/i)
  expect(sql).not.toMatch(/^\s*(prompt|answer|arguments|provider_output|content)\s+(text|jsonb|json)/im)
})

it('adds no schedule, trigger or policy', () => {
  expect(sql).not.toMatch(/cron|pg_cron|create policy|create trigger/i)
})
