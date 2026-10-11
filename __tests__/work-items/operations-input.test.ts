import {it,expect} from 'vitest'
import {parseWorkOperations} from '@/lib/work-items/operations-input'
const plan={targetUrl:'https://fixture.example/page',ownerId:null,dueAt:'2026-10-20',acceptanceCriteria:'Heading and factual response checked',operationStatus:'done',expectedRevision:1}
it('retains an explicit target and manual acceptance',()=>{expect(parseWorkOperations(plan)).toEqual(plan)})
it.each([{...plan,targetUrl:'javascript:alert(1)'},{...plan,targetUrl:'https://user:pass@example.com'},{...plan,acceptanceCriteria:''},{...plan,dueAt:'2026-02-30'},{...plan,ownerId:'foreign-not-id'},{...plan,expectedRevision:0}])('rejects invalid work operation %#',p=>{expect(()=>parseWorkOperations(p)).toThrow()})
