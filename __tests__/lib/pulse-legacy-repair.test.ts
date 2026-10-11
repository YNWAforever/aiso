import {describe,it,expect,vi,beforeEach} from 'vitest'
vi.mock('server-only',()=>({}))
const mocked=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],claimed:true,query:vi.fn(),transaction:vi.fn()}))
vi.mock('@/lib/db',()=>({db:()=>Object.assign(mocked.query,{transaction:mocked.transaction})}))
vi.mock('@/lib/pulse/analysis',()=>({analyseAnswer:vi.fn(()=>{throw new Error('collector must never run')})}))
import {repairLegacyClassifications} from '@/lib/pulse/runs/legacy-repair'
import {naiveAnalysis} from '@/lib/pulse/analysis-fallback'
const id='11111111-1111-4111-8111-111111111111',scope={accountId:'22222222-2222-4222-8222-222222222222',clientId:'33333333-3333-4333-8333-333333333333'}
beforeEach(()=>{vi.clearAllMocks();mocked.claimed=true;mocked.rows=[{id,raw_answer:'Saved immutable answer',classification_status:'legacy_unknown',brand_name:'Synthetic',competitors:[]}];mocked.query.mockImplementation(()=>Promise.resolve(mocked.rows));mocked.transaction.mockImplementation(async()=>[[],mocked.claimed?[{id}]:[]])})
const input=()=>({observationIds:[id],intentKey:'legacy-repair-1',deadlineAt:Date.now()+60000})
describe('classification-only legacy repair',()=>{
 it('classifies the saved body and preserves collection fields',async()=>{const classifier=vi.fn(async()=>({...naiveAnalysis('Saved immutable answer','Synthetic'),classificationStatus:'classified' as const}));expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:1,unchanged:0,failed:0});expect(classifier).toHaveBeenCalledWith({answer:'Saved immutable answer',brandName:'Synthetic',competitors:[]});const sql=mocked.query.mock.calls.map(call=>(call[0] as TemplateStringsArray).join('?')).join(' ');expect(sql).not.toMatch(/set raw_answer|set provider_citations/);expect(sql).toContain('answer_hash');expect(sql).toContain('m.raw_answer=')})
 it('a claimed intent is not charged twice',async()=>{mocked.claimed=false;const classifier=vi.fn();expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:1,failed:0});expect(classifier).not.toHaveBeenCalled()})
 it('rejects mixed foreign observation IDs before any claim or classifier',async()=>{mocked.rows=[];const classifier=vi.fn();await expect(repairLegacyClassifications(scope,input(),classifier)).rejects.toThrow('LEGACY_REPAIR_NOT_FOUND');expect(mocked.transaction).not.toHaveBeenCalled();expect(classifier).not.toHaveBeenCalled()})
 it('does not reclassify an already accepted classification',async()=>{mocked.rows[0].classification_status='classified';const classifier=vi.fn();expect(await repairLegacyClassifications(scope,input(),classifier)).toEqual({classified:0,unchanged:1,failed:0});expect(mocked.transaction).not.toHaveBeenCalled()})
})
