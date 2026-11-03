import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  sql: vi.fn(), transaction: vi.fn(), draft: vi.fn(), domain: vi.fn(),
  profile: vi.fn(), owner: vi.fn(), update: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => Object.assign(m.sql, { transaction: m.transaction }) }))
vi.mock('@/lib/auth', () => ({ getProfile: m.profile }))
vi.mock('@/lib/site-edit/domain', () => ({
  checkEditSpecDomain: m.domain,
  checkEditSpecDomainPinned: async (...args: unknown[]) => {
    const result = await m.domain(...args)
    return { result, pin: result === 'ok' ? { clientDomain: 'https://www.example.com', verifiedDomain: 'www.example.com' } : null }
  },
}))
vi.mock('@/lib/work-items/store', () => ({
  readOwnedDraft: m.draft, loadOwnedDraftClient: m.owner, updateOwnedDraft: m.update,
  findOwnedDraft: vi.fn(), loadOwnedDraftSource: vi.fn(), createDraftIfEvidenceCurrent: vi.fn(), listOwnedDrafts: vi.fn(),
}))

import { submitVersion } from '@/lib/change-sets/store'
import { editAuthenticatedDraft } from '@/lib/work-items/service'
import { parseEditSpec } from '@/lib/site-edit/edit-spec'
import { draft, itemId } from '../change-sets/fixtures'

const id = '11111111-1111-4111-8111-111111111111'
const spec = parseEditSpec({
  schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.example.com/', schemaType: 'Organization',
  payload: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Example Bakery' },
})

beforeEach(() => {
  vi.resetAllMocks()
  m.sql.mockReturnValue([])
  m.profile.mockResolvedValue({ id, account_id: id })
  m.owner.mockResolvedValue({ id })
})

describe('draft save', () => {
  const patch = (body: unknown) => new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) })
  const base = { title: 'Review', action: 'Check', notes: '', expectedRevision: 1 }

  it('stores a spec only on the brand’s verified domain', async () => {
    m.domain.mockResolvedValue('ok')
    m.update.mockResolvedValue({ id: itemId })
    expect(await editAuthenticatedDraft(id, itemId, patch({ ...base, editSpec: spec }))).toEqual({ item: { id: itemId } })
    expect(m.domain).toHaveBeenCalledWith(id, id, spec)
    expect(m.update.mock.calls[0]![4]).toMatchObject({ editSpec: spec })
  })

  it.each([
    ['unverified', 409, 'EDIT_SPEC_DOMAIN_UNVERIFIED'],
    ['mismatch', 400, 'EDIT_SPEC_DOMAIN_MISMATCH'],
  ] as const)('refuses a %s domain before any write', async (result, status, code) => {
    m.domain.mockResolvedValue(result)
    await expect(editAuthenticatedDraft(id, itemId, patch({ ...base, editSpec: spec }))).rejects.toMatchObject({ status, code })
    expect(m.update).not.toHaveBeenCalled()
  })

  it('needs no domain check to keep or clear a spec', async () => {
    m.update.mockResolvedValue({ id: itemId })
    await editAuthenticatedDraft(id, itemId, patch(base))
    await editAuthenticatedDraft(id, itemId, patch({ ...base, editSpec: null }))
    expect(m.domain).not.toHaveBeenCalled()
    expect(m.update.mock.calls[0]![4]).not.toHaveProperty('editSpec')
    expect(m.update.mock.calls[1]![4]).toMatchObject({ editSpec: null })
  })
})

describe('version submit', () => {
  it('freezes the spec and pins the stored edit_spec in the write statement', async () => {
    m.draft.mockResolvedValue({ ...draft(), editSpec: spec })
    m.domain.mockResolvedValue('ok')
    m.transaction.mockResolvedValue([[], [], [{ kind: 'conflict' }]])
    await submitVersion(id, id, itemId, id, 1)
    const call = m.sql.mock.calls.at(-1)!
    expect((call[0] as string[]).join('?')).toContain('d.edit_spec IS NOT DISTINCT FROM')
    expect(call.slice(1)).toContain(JSON.stringify(spec))
    expect(String(call.slice(1).find(v => typeof v === 'string' && v.includes('"editSpec"')))).toContain('Example Bakery')
    // The domain state the check saw is required again inside the INSERT.
    const text = (call[0] as string[]).join('?')
    expect(text).toContain('client_domain_verifications v')
    expect(call.slice(1)).toEqual(expect.arrayContaining(['https://www.example.com', 'www.example.com']))
  })

  it.each(['unverified', 'mismatch'] as const)('freezes nothing when the domain is %s at submit time', async result => {
    m.draft.mockResolvedValue({ ...draft(), editSpec: spec })
    m.domain.mockResolvedValue(result)
    m.transaction.mockResolvedValue([[], [], [{ kind: 'validation_failed' }]])
    expect(await submitVersion(id, id, itemId, id, 1)).toEqual({ kind: 'validation_failed' })
    const values = m.sql.mock.calls.at(-1)!.slice(1)
    expect(values).not.toContain('Review question coverage')
    expect(values.some(v => typeof v === 'string' && v.includes('Example Bakery'))).toBe(false)
  })

  it('fails closed (unavailable) when the domain lookup itself fails', async () => {
    m.draft.mockResolvedValue({ ...draft(), editSpec: spec })
    m.domain.mockRejectedValue(new Error('connection refused'))
    await expect(submitVersion(id, id, itemId, id, 1)).rejects.toThrow('CHANGE_SET_UNAVAILABLE')
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('does not consult the domain for a spec-less draft and pins edit_spec to NULL', async () => {
    m.draft.mockResolvedValue(draft())
    m.transaction.mockResolvedValue([[], [], [{ kind: 'conflict' }]])
    await submitVersion(id, id, itemId, id, 1)
    expect(m.domain).not.toHaveBeenCalled()
    const call = m.sql.mock.calls.at(-1)!
    const sqlText = (call[0] as string[])
    const index = sqlText.findIndex(part => part.includes('d.edit_spec IS NOT DISTINCT FROM'))
    expect(call[index + 1]).toBeNull()
  })
})
