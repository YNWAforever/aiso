const id='11111111-1111-4111-8111-111111111111'
export const itemId='123e4567-e89b-42d3-a456-426614174000'
export function draft(): import('@/lib/work-items/schema').WorkItem {
 return {id:itemId,clientId:id,status:'draft' as const,title:'Review question coverage',action:'Review response.',notes:'',locale:'en' as const,revision:1,createdAt:'2026-09-06T00:00:00Z',updatedAt:'2026-09-06T00:00:00Z',evidenceSnapshot:{schemaVersion:1 as const,source:{kind:'pulse-metric' as const,id:itemId},ruleVersion:'pulse-brand-absent.v1' as const,evidence:{kind:'pulse-metric' as const,id:itemId,promptId:null,question:'Example?',platform:'chatgpt',scanWeek:'2026-08-31',recordedAt:null,result:'success' as const,hasAnswer:true,brandMentioned:false,answerDigest:'a'.repeat(64),provenance:'retained-pulse-metric' as const,limitations:[]},limitations:[],titleKey:'review-question-coverage' as const,actionKey:'review-question-coverage' as const,args:{question:'Example?',platform:'chatgpt'},locale:'en' as const,initialTitle:'Review question coverage',initialAction:'Review response.'}}
}
export async function saved() {
 const {freezeReview}=await import('@/lib/change-sets/validation')
 const f=freezeReview(draft())
 return {id,account_id:id,client_id:id,work_item_id:itemId,version_number:1,draft_revision:1,content:f.content,content_hash:f.contentHash,validation:f.validation,submitter:{profileId:id,displayName:null,role:'account_member'},submitted_at:'2026-09-06T00:00:00Z',decision_record:null,can_decide:false}
}
