import {it,expect,vi} from 'vitest'
vi.mock('server-only',()=>({}))
import {groupOpportunities} from '@/lib/opportunities/groups'
import type {Suggestion} from '@/lib/opportunities/types'
const rows=Array.from({length:5},(_,i)=>({key:'source'+i,source:{kind:'pulse-metric',id:'source'+i},evidence:{kind:'pulse-metric',promptId:'p',question:'Original question',platform:'model'+i,scanWeek:'2026-10-05',recordedAt:'2026-10-06'},monitoringContext:{runId:'r',language:'zh-HK',market:'HK'},savedDraftId:null} as unknown as Suggestion))
it('groups five platforms with all evidence and stable keys',()=>{const groups=groupOpportunities(rows);expect(groups).toHaveLength(1);expect(groups[0].evidenceRefs).toHaveLength(5);expect(groups[0].platforms).toHaveLength(5);expect(groupOpportunities([...rows].reverse())[0].key).toBe(groups[0].key)})
it('separates market, language, immutable question and unknown legacy scope',()=>{expect(groupOpportunities([...rows,{...rows[0],key:'tw',monitoringContext:{runId:'r',language:'zh-HK',market:'TW'}}])).toHaveLength(2);expect(groupOpportunities(rows.map(r=>({...r,monitoringContext:undefined})))).toHaveLength(5)})
