export type WorkOperations={targetUrl:string|null;ownerId:string|null;dueAt:string|null;acceptanceCriteria:string;operationStatus:'todo'|'in_progress'|'done';expectedRevision:number}
export function parseWorkOperations(raw:unknown):WorkOperations{
 const r=raw as WorkOperations;if(!r||typeof r!=='object'||!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<1||typeof r.acceptanceCriteria!=='string'||r.acceptanceCriteria.length>4000||!['todo','in_progress','done'].includes(r.operationStatus))throw new Error('INVALID_WORK_OPERATIONS')
 if(r.targetUrl!==null){if(typeof r.targetUrl!=='string'||r.targetUrl.length>2048)throw new Error('INVALID_TARGET_URL');const u=new URL(r.targetUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('INVALID_TARGET_URL')}
 if(r.ownerId!==null&&(typeof r.ownerId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.ownerId)))throw new Error('INVALID_WORK_OWNER')
 if(r.dueAt!==null&&(typeof r.dueAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.dueAt)||!Number.isFinite(Date.parse(r.dueAt))||new Date(r.dueAt).toISOString().slice(0,10)!==r.dueAt))throw new Error('INVALID_WORK_DUE_DATE')
 const acceptanceCriteria=r.acceptanceCriteria.trim();if(r.operationStatus==='done'&&(!acceptanceCriteria||!r.targetUrl))throw new Error('INVALID_WORK_ACCEPTANCE');return{targetUrl:r.targetUrl,ownerId:r.ownerId,dueAt:r.dueAt,acceptanceCriteria,operationStatus:r.operationStatus,expectedRevision:r.expectedRevision}
}
