import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attestDelivery, readDelivery, readDeliveryVersion, withdrawDelivery } from '@/lib/delivery/store'
import { approvedVersion, attestInput, eventRow, ID, ACTOR_ID, VERSION_ID, REQUEST_ID } from './fixtures'
import type { DeliveryScope } from '@/lib/delivery/types'
const m = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => Object.assign(m.sql, { transaction: m.transaction }) }))
const scope: DeliveryScope = { accountId: ID, clientId: REQUEST_ID, itemId: ID, versionId: VERSION_ID, actorId: ACTOR_ID }
function versionRow() {
  const v = approvedVersion()
  const { id: _id, versionNumber: _number, contentHash: _hash, validation: _validation, submittedBy: _actor, submittedAt: _time, decision: _decision, capabilities: _cap, ...content } = v
  void [_id, _number, _hash, _validation, _actor, _time, _decision, _cap]
  return { id: v.id, account_id: ID, client_id: REQUEST_ID, work_item_id: v.workItemId, draft_revision: v.draftRevision,
    version_number: v.versionNumber, content, content_hash: v.contentHash, validation: v.validation, submitter: v.submittedBy,
    submitted_at: v.submittedAt, can_decide: false, decision_record: { ...v.decision, version_id: v.id, content_hash: v.contentHash,
      actor: v.decision!.decidedBy, actor_id: v.decision!.decidedBy.profileId, decided_at: v.decision!.decidedAt } }
}
const own = () => ({ member: true, owned: true, version: versionRow() })
const statement = (index = -1) => (m.sql.mock.calls.at(index)![0] as string[]).join('?')
const values = (index = -1) => m.sql.mock.calls.at(index)!.slice(1)
const input = () => ({ ...attestInput(), contentHash: approvedVersion().contentHash })
beforeEach(() => { vi.resetAllMocks(); m.sql.mockReturnValue([own()]); m.transaction.mockResolvedValue([[], [], [{ kind: 'conflict' }]]) })

describe('owned delivery reads', () => {
  it('reads an immutable exact decision with account, client, item, version and current profile scope', async () => {
    expect(await readDeliveryVersion(scope)).toMatchObject({ kind: 'replayed', value: { id: VERSION_ID, decision: { decision: 'approved' } } })
    for (const fragment of ['work_item_versions', 'work_item_decisions', 'profiles', 'clients', 'r.content_hash = v.content_hash', 'r.version_id = v.id', 'p.account_id =']) expect(statement()).toContain(fragment)
    for (const id of Object.values(scope)) expect(values()).toContain(id)
    expect(statement()).not.toMatch(/FROM (pulse_metrics|scans)|readOwnedDraft|account_approver_state/)
  })
  it.each([{ member: false, owned: false, kind: 'denied' }, { member: true, owned: false, kind: 'not_found' }, { member: true, owned: true, kind: 'not_found' }])('does not fabricate permission for %j', async ({ member, owned, kind }) => {
    m.sql.mockReturnValue([{ member, owned, version: null }]); expect(await readDeliveryVersion(scope)).toEqual({ kind })
  })
  it('separates malformed retained packages from infrastructure failure', async () => {
    m.sql.mockReturnValueOnce([{ ...own(), version: { ...versionRow(), content_hash: 'b'.repeat(64) } }])
    expect(await readDeliveryVersion(scope)).toEqual({ kind: 'validation_failed' })
    m.sql.mockRejectedValueOnce(new Error('private SQL error'))
    await expect(readDeliveryVersion(scope)).rejects.toThrow('DELIVERY_UNAVAILABLE')
  })
  it('bounds ordered history and preserves same-time UUID cursor with active state outside the page', async () => {
    const row = eventRow(), lower = '123e4567-e89b-42d3-a456-426614173999'
    m.sql.mockReturnValue([{ ...own(), latest_id: VERSION_ID, active_ids: [REQUEST_ID], events: [row, { ...row, id: lower }] }])
    const result = await readDelivery(scope, { limit: 1, cursor: null })
    expect(result).toMatchObject({ kind: 'replayed', value: { activeAttestationId: REQUEST_ID, events: [{ eventId: ID }], capabilities: { canExport: true, canAttest: false, canWithdraw: true, attestReason: 'active_attestation', withdrawReason: null } } })
    if (!('value' in result)) throw new Error('expected page')
    expect(JSON.parse(Buffer.from(result.value.nextCursor!, 'base64url').toString())).toEqual({ recordedAt: row.recorded_at, id: ID })
    expect(statement()).toContain('ORDER BY e.recorded_at DESC,e.id DESC')
    expect(statement()).toContain('(e.recorded_at,e.id) <')
    expect(statement().indexOf('active AS MATERIALIZED')).toBeLessThan(statement().indexOf('page AS'))
    expect(statement()).toContain('SS.US')
    expect(values()).toContain(2)
  })
  it.each([{ decision: null, latest: VERSION_ID, reason: 'not_approved', canExport: false }, { decision: 'changes_requested', latest: VERSION_ID, reason: 'not_approved', canExport: false }, { decision: 'approved', latest: ID, reason: 'superseded', canExport: true }, { decision: 'approved', latest: VERSION_ID, reason: null, canExport: true }])('derives current capabilities %j', async ({ decision, latest, reason, canExport }) => {
    const row = versionRow(); if (decision === null) Object.assign(row, { decision_record: null }); else row.decision_record.decision = decision as 'approved'
    m.sql.mockReturnValue([{ ...own(), version: row, latest_id: latest, active_ids: [], events: [] }])
    expect(await readDelivery(scope, { limit: 20, cursor: null })).toMatchObject({ value: { capabilities: { canExport, canAttest: reason === null, attestReason: reason, canWithdraw: false, withdrawReason: 'no_active_attestation' }, nextCursor: null } })
  })
  it.each([{ active_ids: [ID, REQUEST_ID] }, { events: [{}] }, { active_ids: ['bad'] }, { events: null }])('fails closed on malformed retained history %j', async patch => {
    m.sql.mockReturnValue([{ ...own(), latest_id: VERSION_ID, active_ids: [], events: [], ...patch }])
    expect(await readDelivery(scope, { limit: 20, cursor: null })).toEqual({ kind: 'validation_failed' })
  })
  it('rejects malformed direct scope and cursor before querying', async () => {
    expect(await readDeliveryVersion({ ...scope, actorId: 'bad' })).toEqual({ kind: 'validation_failed' })
    expect(await readDelivery(scope, { limit: 9007199254740992, cursor: null })).toEqual({ kind: 'validation_failed' })
    expect(await readDelivery(scope, { limit: 20, cursor: { recordedAt: '2026-02-30T00:00:00Z', id: ID } })).toEqual({ kind: 'validation_failed' })
    expect(m.sql).not.toHaveBeenCalled()
  })
})

describe('attestation transaction', () => {
  it('uses lazy profile-then-item locks, acquired witnesses and a single post-lock clock', async () => {
    m.transaction.mockResolvedValue([[], [], [{ kind: 'created', value: eventRow() }]])
    expect(await attestDelivery(scope, input())).toMatchObject({ kind: 'created', value: { actor: { profileId: ACTOR_ID, role: 'account_member' } } })
    expect(statement(1)).toContain('FOR SHARE'); expect(statement(2)).toContain('FOR UPDATE')
    expect(statement(1)).toContain("set_config('aiso.version_actor_locked'"); expect(statement(2)).toContain("set_config('aiso.version_item_locked'")
    const sql = statement()
    for (const fragment of ["current_setting('aiso.version_actor_locked'", "current_setting('aiso.version_item_locked'", 'p.account_id =', 'v.content_hash =', 'a.content_hash = v.content_hash', "a.decision = 'approved'", 'max(version_number)', 'NOT EXISTS (SELECT 1 FROM active)', 'NOT EXISTS (SELECT 1 FROM prior)', 'clock AS MATERIALIZED', 'clock_timestamp()', '>= a.decided_at', '<= clock.now', "'account_member'", 'approval_decision_id', 'approval_decision']) expect(sql).toContain(fragment)
    expect(sql.match(/clock_timestamp\(\)/g)).toHaveLength(1)
    expect(sql).not.toMatch(/date_trunc|account_approver_state|INSERT INTO profiles|UPDATE work_item_delivery_events/)
    expect(m.transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'ReadCommitted' })
    expect(values()).toContain(input().contentHash); expect(values()).toContain(input().deliveredAt)
  })
  it.each(['not_found', 'denied', 'conflict', 'validation_failed'] as const)('maps locked %s (missing/moved actor, stale hash/latest/active, invalid time) without inventing an event', async kind => {
    m.transaction.mockResolvedValue([[], [], [{ kind }]])
    expect(await attestDelivery(scope, input())).toEqual({ kind })
    expect(statement()).toContain('INSERT INTO work_item_delivery_events')
  })
  it('replays exact historical input before supersession, withdrawal and package eligibility', async () => {
    m.sql.mockReturnValueOnce([{ ...own(), version: { ...versionRow(), validation: {} } }])
    m.transaction.mockResolvedValue([[], [], [{ kind: 'replayed', value: eventRow() }]])
    expect(await attestDelivery(scope, input())).toMatchObject({ kind: 'replayed' })
    const sql = statement()
    expect(sql.indexOf("THEN 'denied'")).toBeLessThan(sql.indexOf("THEN 'replayed'"))
    expect(sql.indexOf("THEN 'not_found'")).toBeLessThan(sql.indexOf("THEN 'replayed'"))
    expect(sql.indexOf("THEN 'replayed'")).toBeLessThan(sql.indexOf("THEN 'validation_failed'"))
    for (const fragment of ['prior AS MATERIALIZED', 'r.account_id =', 'r.actor_id =', 'r.request_id =', "r.kind = 'attest'", 'r.client_id =', 'r.work_item_id =', 'r.version_id =', 'r.content_hash =', 'r.destination =', 'r.delivered_at =', 'r.note =']) expect(sql).toContain(fragment)
    const prior = sql.slice(sql.indexOf('prior AS MATERIALIZED'), sql.indexOf('replay AS MATERIALIZED'))
    expect(prior).not.toContain('r.work_item_id =')
    expect(values()).toContain(null)
  })
  it('normalizes retry payload identically and never uses actor snapshots supplied by clients', async () => {
    await attestDelivery(scope, { ...input(), destination: ' Site ', deliveredAt: '2026-09-07T08:00:00+08:00', note: ' e\u0301\r\n理由 ' })
    expect(values()).toContain('Site'); expect(values()).toContain('é\n理由'); expect(values()).toContain('2026-09-07T00:00:00.000Z')
    expect(statement()).toContain("jsonb_build_object('profileId',p.id,'displayName',p.display_name,'role','account_member')")
  })
  it('cannot authorize a new insert from an unowned/malformed pre-read', async () => {
    m.sql.mockReturnValueOnce([{ member: false, owned: false, version: null }]); await attestDelivery(scope, input())
    expect(values()).toContain(null)
    expect(statement()).toContain('v.content_hash =')
    expect(statement()).toContain('THEN \'validation_failed\'')
  })
  it('does not convert failed SQL pre-read into a validation or permission success', async () => {
    m.sql.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(attestDelivery(scope, input())).rejects.toThrow('DELIVERY_UNAVAILABLE')
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('constructs lazy locks without awaiting thenables', async () => {
    const then = vi.fn(); m.sql.mockReturnValueOnce([own()]).mockReturnValue({ then })
    await attestDelivery(scope, input()); expect(then).not.toHaveBeenCalled()
  })
})

describe('withdrawal transaction', () => {
  it('binds a same-version attestation without latest/approval eligibility and records only withdrawal fields', async () => {
    const row = { ...eventRow(), id: REQUEST_ID, kind: 'withdraw', destination: null, delivered_at: null, note: null, target_attestation_id: ID, reason: 'Correction' }
    m.transaction.mockResolvedValue([[], [], [{ kind: 'created', value: row }]])
    expect(await withdrawDelivery(scope, ID, { reason: 'Correction', requestId: REQUEST_ID })).toMatchObject({ kind: 'created', value: { kind: 'withdraw', targetAttestationId: ID } })
    expect(statement(0)).toContain('FOR SHARE'); expect(statement(1)).toContain('FOR UPDATE')
    for (const text of ['target AS MATERIALIZED', "e.kind = 'attest'", 'e.version_id = v.id', 'e.content_hash = v.content_hash', 'w.target_attestation_id =', 'NOT EXISTS (SELECT 1 FROM prior)', 'clock AS MATERIALIZED', 'target_kind']) expect(statement()).toContain(text)
    expect(statement()).not.toMatch(/max\(version_number\)|account_approver_state/)
    expect(values()).toContain(ID); expect(values()).toContain('Correction')
  })
  it('replays historical withdrawals and conflicts on changed targets/kinds/reasons/request reuse', async () => {
    m.transaction.mockResolvedValue([[], [], [{ kind: 'conflict' }]])
    expect(await withdrawDelivery(scope, ID, { reason: 'changed', requestId: REQUEST_ID })).toEqual({ kind: 'conflict' })
    for (const text of ["r.kind = 'withdraw'", 'r.target_attestation_id =', 'r.reason =', 'r.client_id =', 'r.work_item_id =', 'r.version_id =']) expect(statement()).toContain(text)
    expect(statement().indexOf("THEN 'replayed'")).toBeLessThan(statement().indexOf("THEN 'conflict'"))
  })
})
it.each(['40001', '40P01'])('bounds injected %s retries and preserves transaction reconstruction', async code => {
  m.transaction.mockRejectedValueOnce({ code }).mockRejectedValueOnce({ code }).mockResolvedValueOnce([[], [], [{ kind: 'created', value: eventRow() }]])
  expect(await attestDelivery(scope, input())).toMatchObject({ kind: 'created' }); expect(m.transaction).toHaveBeenCalledTimes(3)
  m.transaction.mockRejectedValue({ code })
  await expect(withdrawDelivery(scope, ID, { reason: 'why', requestId: REQUEST_ID })).rejects.toThrow('DELIVERY_UNAVAILABLE')
  expect(m.transaction).toHaveBeenCalledTimes(6)
})
it('maps unique conflicts, invalid DTOs and malformed inputs safely', async () => {
  m.transaction.mockRejectedValueOnce({ code: '23505' })
  expect(await attestDelivery(scope, input())).toEqual({ kind: 'conflict' })
  m.transaction.mockResolvedValueOnce([[], [], [{ kind: 'created', value: {} }]])
  expect(await withdrawDelivery(scope, ID, { reason: 'why', requestId: REQUEST_ID })).toEqual({ kind: 'validation_failed' })
  expect(await attestDelivery(scope, { ...input(), contentHash: 'bad' })).toEqual({ kind: 'validation_failed' })
  expect(await withdrawDelivery(scope, 'bad', { reason: 'why', requestId: REQUEST_ID })).toEqual({ kind: 'validation_failed' })
})
