export type OpportunityCursor={accountId:string;clientId:string;week:string;asOf:string;recordedAt:string|null;id:string}
export type OpportunityQuery={cursor:OpportunityCursor|null}
export function encodeOpportunityCursor(cursor:OpportunityCursor){return Buffer.from(JSON.stringify(cursor)).toString('base64url')}
export function parseOpportunityQuery(params:URLSearchParams,accountId:string,clientId:string):OpportunityQuery{
 const keys=[...params.keys()]
 if(keys.length>1||keys.some(key=>key!=='cursor'))throw new Error('INVALID_OPPORTUNITY_QUERY')
 const raw=params.get('cursor')
 if(raw===null)return{cursor:null}
 try{
  if(!/^[A-Za-z0-9_-]{1,2048}$/.test(raw))throw new Error()
  const bytes=Buffer.from(raw,'base64url')
  if(bytes.toString('base64url')!==raw)throw new Error()
  const cursor=JSON.parse(bytes.toString('utf8')) as OpportunityCursor
  const timestamp=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)&&Number.isFinite(Date.parse(value))
  if(!cursor||Object.keys(cursor).sort().join(',')!=='accountId,asOf,clientId,id,recordedAt,week'||cursor.accountId!==accountId||cursor.clientId!==clientId||!/^\d{4}-\d{2}-\d{2}$/.test(cursor.week)||!timestamp(cursor.asOf)||(cursor.recordedAt!==null&&!timestamp(cursor.recordedAt))||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id))throw new Error()
  return{cursor}
 }catch{throw new Error('INVALID_OPPORTUNITY_QUERY')}
}
