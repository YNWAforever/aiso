import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { readShareOfVoice } from '@/lib/pulse/share-of-voice'

/**
 * Share of voice read against real Postgres: the eight-week window, the
 * classified-and-non-blank filter, the prompt join and tenancy are SQL, so a
 * mock cannot prove them.
 */

const sql = neon(process.env.TEST_DATABASE_URL!)
const ACCOUNT = 'c4000000-0000-4000-8000-000000000001'
const OTHER = 'c4000000-0000-4000-8000-000000000002'
const CLIENT = 'c4000000-0000-4000-8000-000000000003'
const PROMPT = 'c4000000-0000-4000-8000-000000000004'

async function metric(week: string, values: { brand: boolean | null; competitors?: string[]; status?: string; answer?: string; platform?: string }) {
  await sql`
    insert into pulse_metrics (client_id, prompt_id, platform, question, raw_answer, brand_mentioned, sentiment,
                               competitors_mentioned, scan_week, classification_status)
    values (${CLIENT}::uuid, ${PROMPT}::uuid, ${values.platform ?? 'gpt-4o'}, 'Stored question', ${values.answer ?? 'An answer.'},
            ${values.brand}, 'neutral', ${values.competitors ?? []}::text[], ${week}::date, ${values.status ?? 'classified'})
  `
}

beforeAll(async () => {
  const [identity] = await sql`select current_setting('neon.project_id') as project`
  expect(identity.project).toBe(process.env.EXPECTED_NEON_PROJECT_ID)
})

beforeEach(async () => {
  await sql`delete from pulse_metrics where client_id = ${CLIENT}::uuid`
  await sql`delete from prompt_bank where client_id = ${CLIENT}::uuid`
  await sql`delete from competitors where account_id in (${ACCOUNT}::uuid, ${OTHER}::uuid)`
  await sql`delete from clients where account_id in (${ACCOUNT}::uuid, ${OTHER}::uuid)`
  for (const account of [ACCOUNT, OTHER]) {
    await sql`delete from accounts where id = ${account}::uuid`
    await sql`insert into accounts (id, plan, status) values (${account}::uuid, 'basic', 'active')`
  }
  await sql`insert into clients (id, account_id, brand_name, domain, competitors)
            values (${CLIENT}::uuid, ${ACCOUNT}::uuid, 'Fimmick Bank', 'example.com', array['Citi'])`
  await sql`insert into prompt_bank (id, client_id, category, question, is_active)
            values (${PROMPT}::uuid, ${CLIENT}::uuid, 'brand_query', 'Best bank in Hong Kong?', true)`
  await sql`insert into competitors (account_id, client_id, name, aliases)
            values (${ACCOUNT}::uuid, ${CLIENT}::uuid, 'HSBC Holdings', array['HSBC'])`
})

describe('readShareOfVoice', () => {
  it('counts only classified, non-blank answers with a brand decision', async () => {
    await metric('2026-10-05', { brand: true, competitors: ['HSBC'] })
    await metric('2026-10-05', { brand: false, competitors: ['Citi', 'HSBC Holdings'], platform: 'gemini-flash' })
    await metric('2026-10-05', { brand: true, status: 'fallback' })          // not classified
    await metric('2026-10-05', { brand: false, answer: '   ' })              // blank body
    await metric('2026-10-05', { brand: null })                              // no brand decision
    const view = (await readShareOfVoice(sql as never, ACCOUNT, CLIENT))!
    const cell = (label: string) => view.subjects.find(s => s.label === label)!.cells['2026-10-05']['*']
    expect(view.weeks).toEqual(['2026-10-05'])
    expect(cell('Fimmick Bank')).toEqual({ mentions: 1, answers: 2, share: 50 })
    expect(cell('HSBC Holdings')).toEqual({ mentions: 2, answers: 2, share: 100 })
    // Citi is only in the legacy array, and still a configured competitor.
    expect(view.subjects.find(s => s.label === 'Citi')?.kind).toBe('competitor')
    expect(cell('Citi')).toEqual({ mentions: 1, answers: 2, share: 50 })
    // The question comes from the prompt bank, not the copy stored on the metric.
    expect(view.prompts.map(p => p.question)).toEqual(['Best bank in Hong Kong?'])
  })

  it('reads the most recent eight weeks only', async () => {
    for (let i = 0; i < 10; i++) {
      const week = new Date(Date.UTC(2026, 7, 3 + i * 7)).toISOString().slice(0, 10)
      await metric(week, { brand: true })
    }
    const view = (await readShareOfVoice(sql as never, ACCOUNT, CLIENT))!
    expect(view.weeks).toHaveLength(8)
    expect(view.weeks[0]).toBe('2026-10-05')
    expect(view.weeks).not.toContain('2026-08-03')
  })

  it('returns null for another account, never its numbers', async () => {
    await metric('2026-10-05', { brand: true })
    expect(await readShareOfVoice(sql as never, OTHER, CLIENT)).toBeNull()
  })
})
