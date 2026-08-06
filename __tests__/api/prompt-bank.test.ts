import { describe, it, expect, vi, beforeEach } from 'vitest'

type Call = { text: string; params: unknown[] }

const calls: Call[] = []
let ownedRows: unknown[]
let promptRows: unknown[]
let writeRows: unknown[]
let failOn: RegExp | null

const mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })
  if (failOn && failOn.test(text)) return Promise.reject(new Error('boom'))
  // Dispatch on the leading verb, not on table names: `delete from prompt_bank`
  // and the POST pre-check's `from clients` both mention more than one table.
  if (!/^\s*select/i.test(text)) return Promise.resolve(writeRows)
  if (/from clients\b/i.test(text)) return Promise.resolve(ownedRows)
  return Promise.resolve(promptRows)
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { GET, POST } from '@/app/api/dashboard/clients/[clientId]/prompts/route'
import { PATCH, DELETE } from '@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route'
import { getProfile } from '@/lib/auth'
import { MAX_PROMPTS } from '@/lib/pulse/limits'

function account(plan: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    account_id: 'acc-1',
    accounts: { plan, status: 'active', stripe_subscription_id: 'sub_1', ...overrides },
  }
}

const clientParams = { params: Promise.resolve({ clientId: 'client-1' }) }
const itemParams = { params: Promise.resolve({ clientId: 'client-1', promptId: 'prompt-1' }) }

const get = () => GET(new Request('http://localhost'), clientParams)
const post = (body: unknown = { category: 'brand_query', question: 'What is AcmeCo?' }) =>
  POST(new Request('http://localhost', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), clientParams)
const patch = (body: unknown = { question: 'Updated?' }) =>
  PATCH(new Request('http://localhost', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), itemParams)
const del = () => DELETE(new Request('http://localhost', { method: 'DELETE' }), itemParams)

const PROMPT = {
  id: 'prompt-1', client_id: 'client-1', category: 'brand_query',
  question: 'What is AcmeCo?', language: 'en', is_active: true,
  created_at: '2026-08-01T00:00:00Z',
}

beforeEach(() => {
  calls.length = 0
  failOn = null
  ownedRows = [{ id: 'client-1', prompt_count: 3 }]
  promptRows = [PROMPT]
  writeRows = [PROMPT]
  vi.mocked(getProfile).mockReset()
  vi.mocked(getProfile).mockResolvedValue(account('pro') as never)
})

// Every write route shares one guard, so the contract is asserted against all
// three rather than only where it happens to be exercised.
const WRITES = [
  { name: 'POST', call: () => post() },
  { name: 'PATCH', call: () => patch() },
  { name: 'DELETE', call: () => del() },
] as const

describe('question bank gating', () => {
  it.each([...WRITES, { name: 'GET', call: get }])(
    '$name returns 401 and touches nothing when unauthenticated',
    async ({ call }) => {
      vi.mocked(getProfile).mockResolvedValue(null as never)
      const res = await call()

      expect(res.status).toBe(401)
      expect(calls).toHaveLength(0)
    },
  )

  // The regression test for the hole this restoration closes: pre-fence, POST
  // gated on edit_prompts while PATCH and DELETE gated on nothing, so a Basic
  // user could not add a question but could rewrite or delete every one.
  it.each(WRITES)('$name refuses a plan without edit_prompts, before any query', async ({ call }) => {
    for (const plan of ['free', 'basic']) {
      calls.length = 0
      vi.mocked(getProfile).mockResolvedValue(account(plan) as never)
      const res = await call()

      expect(res.status, `${plan} must be refused`).toBe(403)
      expect(await res.json()).toMatchObject({ error: 'UPGRADE_REQUIRED', feature: 'edit_prompts' })
      // Zero queries is what proves entitlement runs before ownership — an
      // unentitled caller cannot probe which client ids exist on their account.
      expect(calls).toHaveLength(0)
    }
  })

  it.each(WRITES)('$name refuses a cancelled account still carrying plan=pro', async ({ call }) => {
    vi.mocked(getProfile).mockResolvedValue(account('pro', { status: 'cancelled' }) as never)

    expect((await call()).status).toBe(403)
  })

  it('GET is allowed on basic — reading your own questions is not the paid capability', async () => {
    vi.mocked(getProfile).mockResolvedValue(account('basic') as never)

    expect((await get()).status).toBe(200)
  })
})

describe('GET /prompts', () => {
  it('scopes the ownership lookup by both client and account', async () => {
    await get()

    expect(calls[0].params).toEqual(['client-1', 'acc-1'])
  })

  it('returns 404 for a brand on another account', async () => {
    ownedRows = []
    const res = await get()

    expect(res.status).toBe(404)
    expect(calls.some(c => /from prompt_bank/i.test(c.text))).toBe(false)
  })

  it('returns 503, not 404, when the ownership lookup itself fails', async () => {
    failOn = /from clients/i
    expect((await get()).status).toBe(503)
  })

  it('returns 503 when the prompt list fails', async () => {
    failOn = /from prompt_bank/i
    expect((await get()).status).toBe(503)
  })

  it('breaks created_at ties on id so ordering is stable between requests', async () => {
    // Every row an onboarding writes shares one created_at (transaction time),
    // so without the tiebreak intra-category order varies per request.
    await get()
    const list = calls.find(c => /from prompt_bank/i.test(c.text))!

    expect(list.text).toMatch(/order by category, created_at, id/)
  })

  it('returns the prompts', async () => {
    const res = await get()

    expect(await res.json()).toEqual({ prompts: [PROMPT] })
  })
})

describe('POST /prompts', () => {
  it('rejects a category outside the vocabulary before writing anything', async () => {
    // The exact payload the editor's add-row used to send.
    const res = await post({ category: 'Brand Queries', question: 'What is AcmeCo?' })

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['missing question', { category: 'brand_query' }],
    ['blank question', { category: 'brand_query', question: '   ' }],
    ['oversized question', { category: 'brand_query', question: 'x'.repeat(501) }],
    ['missing category', { question: 'What is AcmeCo?' }],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('returns 400 for a body that is not a JSON object', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post(['array'])).status).toBe(400)
  })

  it('returns 404 for another account\'s brand and writes nothing', async () => {
    ownedRows = []
    const res = await post()

    expect(res.status).toBe(404)
    expect(calls.some(c => /insert into prompt_bank/i.test(c.text))).toBe(false)
  })

  it('refuses at the cap rather than accepting a question that will never be scanned', async () => {
    // Past MAX_PROMPTS the weekly run silently scans an arbitrary id-ordered
    // subset, so a 201 here would be a lie.
    ownedRows = [{ id: 'client-1', prompt_count: MAX_PROMPTS }]
    const res = await post()

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'PROMPT_LIMIT_REACHED', max: MAX_PROMPTS })
    expect(calls.some(c => /insert into prompt_bank/i.test(c.text))).toBe(false)
  })

  it('carries tenancy inside the insert, not only in the pre-check', async () => {
    await post()
    const insert = calls.find(c => /insert into prompt_bank/i.test(c.text))!

    expect(insert.text).toMatch(/account_id/)
    expect(insert.params).toContain('acc-1')
  })

  it('takes client_id from the path, never from the body', async () => {
    await post({ category: 'brand_query', question: 'q', client_id: 'client-evil' })
    const insert = calls.find(c => /insert into prompt_bank/i.test(c.text))!

    expect(insert.params).not.toContain('client-evil')
    expect(insert.params).toContain('client-1')
  })

  it('returns 201 with the created prompt', async () => {
    const res = await post()

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ prompt: PROMPT })
  })

  it('returns 500 rather than a success over a failed insert', async () => {
    failOn = /insert into prompt_bank/i
    expect((await post()).status).toBe(500)
  })
})

describe('PATCH /prompts/[promptId]', () => {
  it('returns 400 when no updatable field is present, before any query', async () => {
    // Expressed in JS rather than SQL: `where $1 is not null` triggers "could
    // not determine data type of parameter", and would 404 a bad request.
    expect((await patch({})).status).toBe(400)
    expect((await patch({ category: 'brand_query' })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['blank', { question: '  ' }],
    ['oversized', { question: 'x'.repeat(501) }],
  ])('returns 400 for a %s question', async (_label, body) => {
    expect((await patch(body)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('sends only question and is_active to the statement', async () => {
    await patch({ question: 'Updated?', is_active: false, category: 'pain_point', id: 'other' })

    expect(calls[0].params).toEqual(['Updated?', false, 'prompt-1', 'client-1', 'acc-1'])
  })

  it('scopes the update by prompt, client and account in one statement', async () => {
    await patch()

    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(/update prompt_bank p/i)
    expect(calls[0].text).toMatch(/from clients c/i)
    expect(calls[0].text).toMatch(/c\.account_id =/)
    // Both predicates matter: c.account_id alone would let a prompt be reached
    // through any of the account's brands, and p.client_id alone would let it
    // be reached from another account entirely.
    expect(calls[0].text).toMatch(/p\.client_id =/)
    expect(calls[0].text).toMatch(/c\.id = p\.client_id/)
  })

  it('never selects the joined client columns back', async () => {
    // prompt_bank and clients share `id` and `created_at`, and the Neon driver
    // builds rows with Object.fromEntries — duplicate names overwrite, last
    // wins, and the joined relation comes second. A bare `returning *` would
    // hand back prompt.id = <clientId>, and the next PATCH would 404 against an
    // id that never existed.
    await patch()

    expect(calls[0].text).toMatch(/returning p\./)
    expect(calls[0].text).not.toMatch(/returning\s+\*/)
  })

  it('returns 404 when the statement matches no row', async () => {
    writeRows = []
    expect((await patch()).status).toBe(404)
  })

  it('returns 500 when the update throws', async () => {
    failOn = /update prompt_bank/i
    expect((await patch()).status).toBe(500)
  })
})

describe('DELETE /prompts/[promptId]', () => {
  it('scopes the delete by prompt, client and account in one statement', async () => {
    await del()

    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(/delete from prompt_bank p/i)
    expect(calls[0].text).toMatch(/using clients c/i)
    expect(calls[0].text).toMatch(/c\.account_id =/)
    expect(calls[0].text).toMatch(/p\.client_id =/)
    expect(calls[0].text).toMatch(/c\.id = p\.client_id/)
    expect(calls[0].params).toEqual(['prompt-1', 'client-1', 'acc-1'])
  })

  it('returns 404 when the statement matches no row', async () => {
    writeRows = []
    expect((await del()).status).toBe(404)
  })

  it('returns 204 on success', async () => {
    expect((await del()).status).toBe(204)
  })

  it('returns 500 when the delete throws', async () => {
    failOn = /delete from prompt_bank/i
    expect((await del()).status).toBe(500)
  })
})
