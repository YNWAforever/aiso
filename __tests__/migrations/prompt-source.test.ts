import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { assertNoTransactionControl } from '@/scripts/migrate'
import { isPromptSource } from '@/lib/prompts/source'

/**
 * Forward migration 100: prompt provenance. Applied here onto a reduced
 * prompt_bank that matches the production columns it reads, because the only
 * thing that can prove the backfill is a database.
 */
const migration = readFileSync('supabase/migrations/100_prompt_source.sql', 'utf8')

async function database() {
  const pg = await PGlite.create()
  await pg.exec(`
    create table public.prompt_bank(
      id uuid primary key default gen_random_uuid(), client_id uuid not null, category text, question text not null,
      language text, market text, is_active boolean not null default true, onboarding_seed_key text,
      created_at timestamptz default now());
    insert into public.prompt_bank(client_id, question, onboarding_seed_key) values
      ('10000000-0000-4000-8000-000000000001', 'Seeded by onboarding', 'seed-a'),
      ('10000000-0000-4000-8000-000000000001', 'Typed by the operator', null);
  `)
  await pg.exec(migration)
  return pg
}

describe('100 prompt source', () => {
  it('rejects transaction control and touches only prompt_bank', () => {
    expect(() => assertNoTransactionControl('100_prompt_source.sql', migration)).not.toThrow()
    expect(migration).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/i)
    expect(migration).toMatch(/alter table public\.prompt_bank add column if not exists source text/i)
  })

  it('backfills only rows that already carried the onboarding seed marker', async () => {
    const pg = await database()
    try {
      const { rows } = await pg.query<{ question: string; source: string | null }>(
        'select question, source from public.prompt_bank order by question')
      expect(rows).toEqual([
        { question: 'Seeded by onboarding', source: 'profile' },
        { question: 'Typed by the operator', source: null },
      ])
    } finally { await pg.close() }
  })

  it('accepts the recorded vocabulary and refuses anything else', async () => {
    const pg = await database()
    try {
      for (const source of ['profile', 'demand', null]) {
        await expect(pg.query('update public.prompt_bank set source = $1 where question = $2',
          [source, 'Typed by the operator'])).resolves.toBeTruthy()
      }
      await expect(pg.query(`update public.prompt_bank set source = 'manual' where question = 'Typed by the operator'`))
        .rejects.toThrow()
    } finally { await pg.close() }
  })

  it('is safe to re-run and never rewrites a recorded source', async () => {
    const pg = await database()
    try {
      await pg.query(`update public.prompt_bank set source = 'demand' where question = 'Seeded by onboarding'`)
      await pg.exec(migration)
      const { rows } = await pg.query<{ source: string | null }>(
        `select source from public.prompt_bank where question = 'Seeded by onboarding'`)
      expect(rows).toEqual([{ source: 'demand' }])
    } finally { await pg.close() }
  })
})

describe('prompt source vocabulary', () => {
  it('accepts only the stored values', () => {
    expect(['profile', 'demand'].every(isPromptSource)).toBe(true)
    for (const value of [null, undefined, '', 'manual', 'Demand', 42]) expect(isPromptSource(value)).toBe(false)
  })
})
