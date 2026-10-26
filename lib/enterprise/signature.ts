import 'server-only'
import { createHash,createHmac,timingSafeEqual } from 'node:crypto'
import { shareSigningSecret } from '@/lib/security/share-secret'
import { UUID } from '@/lib/outcome-integrations/input'
type SignedRequest={timestamp:string;nonce:string;method:string;path:string;body:string}
const mac=(secret:string,message:string)=>createHmac('sha256',secret).update(message).digest('hex')
const equal=(a:string,b:string)=>/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'))
export function signEnterpriseRequest(secret:string,input:SignedRequest){return mac(secret,['aiso-api:v1',input.timestamp,input.nonce,input.method.toUpperCase(),input.path,createHash('sha256').update(input.body).digest('hex')].join('\n'))}
export function verifyEnterpriseRequest(secret:string,input:SignedRequest,signature:string,now=Date.now()){
 return /^\d{10}$/.test(input.timestamp)&&UUID.test(input.nonce)&&Math.abs(now-Number(input.timestamp)*1000)<=300000&&equal(signEnterpriseRequest(secret,input),signature)
}
export function signEnterpriseWebhook(secret:string,timestamp:string,body:string){return mac(secret,`aiso-webhook:v1\n${timestamp}\n${body}`)}
type PortalLink={slug:string;version:number;locale:'en'|'zh-HK'}
function portalMessage(input:PortalLink){if(!/^[A-Za-z0-9_-]{32}$/.test(input.slug)||!Number.isSafeInteger(input.version)||input.version<1||!['en','zh-HK'].includes(input.locale))throw new Error('INVALID_PORTAL_LINK');return`aiso-portal:v1:${input.slug}:${input.version}:${input.locale}`}
export function signPortalLink(input:PortalLink){return mac(shareSigningSecret(),portalMessage(input))}
export function verifyPortalLink(input:PortalLink&{signature:string}){try{return equal(signPortalLink(input),input.signature)}catch{return false}}
