import { object,text,uuid,OutcomeError } from '@/lib/outcome-integrations/input'
const bad=():never=>{throw new OutcomeError('INVALID_ENTERPRISE_INPUT')}
export function locale(value:unknown):'en'|'zh-HK'{if(value!=='en'&&value!=='zh-HK')return bad();return value}
export function publicHttpsUrl(value:unknown):string {
 const raw=text(value,2048);let url:URL;try{url=new URL(raw)}catch{return bad()}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!url.hostname.includes('.')||/[\[\]:]/.test(url.hostname)||/^[\d.]+$/.test(url.hostname)||/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname))return bad()
 return url.href
}
export function parsePortalConfig(raw:unknown){const b=object(raw,['name','companyName','primaryColor','logoUrl','locale']);const color=text(b.primaryColor,7);if(!/^#[a-f\d]{6}$/i.test(color))return bad();return{name:text(b.name,100),companyName:text(b.companyName,100),primaryColor:color.toUpperCase(),logoUrl:b.logoUrl===null?null:publicHttpsUrl(b.logoUrl),locale:locale(b.locale)}}
export function parseExecutiveSchedule(raw:unknown){const b=object(raw,['name','cadence','locale','recipientIds','enabled']);if(!['weekly','monthly'].includes(String(b.cadence))||typeof b.enabled!=='boolean'||!Array.isArray(b.recipientIds)||b.recipientIds.length<1||b.recipientIds.length>20)return bad();return{name:text(b.name,100),cadence:b.cadence as 'weekly'|'monthly',locale:locale(b.locale),recipientIds:[...new Set(b.recipientIds.map(uuid))],enabled:b.enabled}}
export const API_SCOPES=['outcomes:read','visibility:read','reports:read','adapter:write'] as const
export type EnterpriseScope=typeof API_SCOPES[number]
export function parseEnterpriseKey(raw:unknown){const b=object(raw,['name','scopes','adapterId']);if(!Array.isArray(b.scopes)||!b.scopes.length||b.scopes.length>4||b.scopes.some(s=>!API_SCOPES.includes(s)))return bad();const adapterId=b.adapterId===null?null:uuid(b.adapterId);if(b.scopes.includes('adapter:write')&&!adapterId)return bad();return{name:text(b.name,100),scopes:[...new Set(b.scopes)] as EnterpriseScope[],adapterId}}
export type EnterpriseRole='viewer'|'editor'|'manager'
export function parseEnterpriseRole(raw:unknown){const b=object(raw,['profileId','role','expectedRevision','requestId','reason']);if(!['viewer','editor','manager'].includes(String(b.role))||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0)return bad();return{profileId:uuid(b.profileId),role:b.role as EnterpriseRole,expectedRevision:Number(b.expectedRevision),requestId:uuid(b.requestId),reason:text(b.reason,1000)}}
export function parseAdapterConfig(raw:unknown){const b=object(raw,['name','model','temperature']);if(b.temperature!==null&&(typeof b.temperature!=='number'||!Number.isFinite(b.temperature)||b.temperature<0||b.temperature>2))return bad();return{name:text(b.name,100),model:text(b.model,200),temperature:b.temperature as number|null}}
export function parseAdapterObservation(raw:unknown,now=new Date()){
 const b=object(raw,['eventId','runId','promptId','observedAt','actualModel','answer','citations']);const stamp=text(b.observedAt,40),time=Date.parse(stamp)
 if(!/^\d{4}-\d\d-\d\dT/.test(stamp)||!Number.isFinite(time)||time>now.getTime()+300000||time<now.getTime()-30*86400000||typeof b.answer!=='string'||!b.answer.trim()||b.answer.length>6000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(b.answer)||(b.citations!==null&&(!Array.isArray(b.citations)||b.citations.length>20)))return bad()
 const citations=b.citations===null?null:(b.citations as unknown[]).map(value=>{const c=object(value,['url']);return{url:publicHttpsUrl(c.url)}})
 return{eventId:uuid(b.eventId),runId:uuid(b.runId),promptId:uuid(b.promptId),observedAt:new Date(time).toISOString(),actualModel:text(b.actualModel,200),answer:b.answer,citations}
}
export function parseDecision(raw:unknown){const b=object(raw,['artifactId','decision','reason','requestId']);if(b.decision!=='approved'&&b.decision!=='rejected')return bad();return{artifactId:uuid(b.artifactId),decision:b.decision,reason:text(b.reason,1000),requestId:uuid(b.requestId)}}
