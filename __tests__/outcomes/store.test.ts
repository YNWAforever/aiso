import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({sql:vi.fn()}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({db:()=>m.sql}))
import { readOutcomeInput } from '@/lib/outcomes/store'
import { snapshot, scanSnapshot } from './snapshot-fixtures'
import { freezeMultiSourceReview } from '@/lib/change-sets/validation'
import { approvedVersion } from '../delivery/fixtures'
import { ID, ACTOR_ID, REQUEST_ID, VERSION_ID } from '../delivery/fixtures'
const scope = { accountId: ID, actorId: ACTOR_ID, clientId: REQUEST_ID, itemId: ID, versionId: VERSION_ID }
beforeEach(()=>{m.sql.mockReset(); m.sql.mockResolvedValue([snapshot()])})
it('reads one coherent tagged snapshot with all owned relationships and no writes',async()=>{
 expect(await readOutcomeInput(scope)).toMatchObject({kind:'ok',value:{versionId:VERSION_ID}})
 expect(m.sql).toHaveBeenCalledTimes(1)
 const statement = m.sql.mock.calls[0][0].join('?')
 for(const value of Object.values(scope)) expect(m.sql.mock.calls[0].slice(1)).toContain(value)
 for(const fragment of ['p.account_id =','c.account_id = d.account_id','r.content_hash = v.content_hash','e.content_hash = v.content_hash','e.approval_decision_id','statement_timestamp()','SS.US','LIMIT 201','m.question =','m.platform =','promptId','s.account_id = v.account_id']) expect(statement).toContain(fragment)
 expect(statement).not.toMatch(/INSERT|UPDATE|DELETE|FOR SHARE|clock_timestamp|JOIN prompts|::timestamptz/)
 expect(statement).not.toMatch(/SELECT[^;]*m\.raw_answer,/)
})
it.each([{member:false,owned:false,kind:'denied'},{member:true,owned:false,kind:'not_found'},{member:true,owned:true,kind:'not_found'}])('denies absent scope %j',async({kind,...row})=>{
 m.sql.mockResolvedValue([{...row,version:null}])
 expect(await readOutcomeInput(scope)).toEqual({kind})
 expect(m.sql).toHaveBeenCalledTimes(1)
})
it('fails closed for missing/invalid snapshot, source SQL error, and scope mismatch',async()=>{
 for(const rows of [[],[{}],[{...snapshot(),version:{}}],[{...snapshot(),version:{...snapshot().version,client_id:ID}}]]){
 m.sql.mockResolvedValue(rows); expect(await readOutcomeInput(scope)).toEqual({kind:'unavailable'})
 }
 m.sql.mockRejectedValue(new Error('private details')); expect(await readOutcomeInput(scope)).toEqual({kind:'unavailable'})
})
it('rejects malformed scope without issuing SQL',async()=>{
 expect(await readOutcomeInput({...scope,actorId:'bad'})).toEqual({kind:'unavailable'})
 expect(m.sql).not.toHaveBeenCalled()
})

function multiSourceRow() {
 const row = snapshot(), version = approvedVersion(), pulse = version.evidenceSnapshot
 const frozen = freezeMultiSourceReview({ ...version, id: version.workItemId, revision: version.draftRevision }, [pulse, scanSnapshot().version.content.evidenceSnapshot, pulse])
 Object.assign(row.version, { content: frozen.content, content_hash: frozen.contentHash, validation: frozen.validation })
 row.version.decision_record.content_hash = frozen.contentHash
 row.events[0].content_hash = frozen.contentHash
 return row
}

it('dispatches actual frozen V2 content without changing requested ownership or issuing another query', async () => {
 const row = multiSourceRow()
 m.sql.mockResolvedValue([row])
 expect(await readOutcomeInput(scope)).toMatchObject({ kind: 'ok', value: {
  schemaVersion: 2, contentHash: row.version.content_hash,
  sources: [{ sourceIndex: 0 }, { sourceIndex: 1 }, { sourceIndex: 2 }],
 } })
 expect(m.sql).toHaveBeenCalledTimes(1)
})

it('uses a guarded frozen union and exactly one bounded EXISTS pool per kind, never a source join or JSON-time cast', async () => {
 await readOutcomeInput(scope)
 const statement: string = m.sql.mock.calls[0][0].join('?')
 expect(statement.match(/\bLIMIT 201\b/g)).toHaveLength(2)
 expect(statement).toContain("v.content -> 'schemaVersion' = '2'::jsonb")
 expect(statement).toContain("jsonb_typeof(v.content -> 'evidenceSnapshots') = 'array'")
 expect(statement).toContain("jsonb_build_array(v.content -> 'evidenceSnapshot')")
 expect(statement).toContain("ELSE '[]'::jsonb END")
 for (const pool of [statement.split('scan_candidates AS MATERIALIZED (')[1].split('), pulse_candidates')[0], statement.split('pulse_candidates AS MATERIALIZED (')[1].split(') SELECT EXISTS')[0]]) {
  expect(pool).toContain('WHERE EXISTS (SELECT 1 FROM frozen_sources f')
  expect(pool).toContain('DESC NULLS LAST')
  expect(pool).not.toMatch(/JOIN frozen_sources|LATERAL|jsonb_array_elements/)
 }
 expect(statement).toContain("m.question = f.snapshot #>> '{evidence,question}'")
 expect(statement).toContain("m.platform = f.snapshot #>> '{evidence,platform}'")
 expect(statement).toContain("(f.snapshot #>> '{evidence,promptId}') IS NULL")
 expect(statement).toContain("m.prompt_id::text = f.snapshot #>> '{evidence,promptId}'")
 expect(statement.split('history AS MATERIALIZED (')[1].split('), scan_candidates')[0]).not.toMatch(/LIMIT/)
 expect(statement).not.toMatch(/::timestamptz|JOIN prompt_bank|INSERT|UPDATE|DELETE/)
})

it.each(['account_id', 'client_id', 'work_item_id', 'id'] as const)('fails V2 closed for crossed primary %s before projection', async field => {
 const row = multiSourceRow()
 Object.assign(row.version, { [field]: ACTOR_ID })
 m.sql.mockResolvedValue([row])
 expect(await readOutcomeInput(scope)).toEqual({ kind: 'unavailable' })
})

it('does not treat a malformed frozen V2 package as a successful partial source response', async () => {
 const row = multiSourceRow()
 Object.assign(row.version.content, { evidenceSnapshots: [] })
 m.sql.mockResolvedValue([row])
 expect(await readOutcomeInput(scope)).toEqual({ kind: 'unavailable' })
})
