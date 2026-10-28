/** External connector helper. Importing this file performs no I/O or DB writes.
 * Providers run in your connector; no executable code is uploaded to AISO. */
import { createHash,createHmac,timingSafeEqual,randomUUID } from 'node:crypto'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function apiSignature(secret,{timestamp,nonce,method,path,body}){
 return createHmac('sha256',secret).update(['aiso-api:v1',timestamp,nonce,method.toUpperCase(),path,createHash('sha256').update(body).digest('hex')].join('\n')).digest('hex')
}
export function verifyWebhook(secret,{timestamp,body,signature,eventId},now=Date.now()){
 if(!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||Buffer.byteLength(body)>32768||!/^[a-f0-9]{64}$/.test(signature))return false
 const expected=createHmac('sha256',secret).update(`aiso-webhook:v1\n${timestamp}\n${body}`).digest('hex')
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex')))return false
 try{const event=JSON.parse(body);return event.version==='v1'&&uuid.test(event.id)&&event.id===eventId}catch{return false}
}
export async function enterpriseRequest({origin,clientId,keyId,secret,resource,body,fetchImpl=fetch}){
 const base=new URL(origin);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||!uuid.test(clientId)||!uuid.test(keyId)||!['adapters','results','outcomes','visibility','reports'].includes(resource))throw new Error('INVALID_CONNECTOR_CONFIG')
 const method=resource==='results'?'POST':'GET',raw=method==='POST'?JSON.stringify(body):''
 if(Buffer.byteLength(raw)>65536)throw new Error('CONNECTOR_BODY_TOO_LARGE')
 const url=new URL(`/api/v1/clients/${clientId}/${resource}`,base),input={timestamp:String(Math.floor(Date.now()/1000)),nonce:randomUUID(),method,path:url.pathname+url.search,body:raw}
 let response
 try{response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-AISO-Key':keyId,'X-AISO-Timestamp':input.timestamp,'X-AISO-Nonce':input.nonce,'X-AISO-Signature':apiSignature(secret,input)},...(method==='POST'?{body:raw}:{})})}catch{throw new Error('CONNECTOR_DELIVERY_UNCONFIRMED')}
 if(!response.ok){await response.body?.cancel();throw new Error(`CONNECTOR_HTTP_${response.status}`)}
 // AISO API responses have a documented 2.5 MB cap; bound connector reads too.
 const reader=response.body?.getReader();if(!reader)throw new Error('CONNECTOR_RESPONSE_INVALID')
 const chunks=[];let size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2500000){await reader.cancel();throw new Error('CONNECTOR_RESPONSE_TOO_LARGE')}chunks.push(part.value)}}finally{reader.releaseLock()}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new Error('CONNECTOR_RESPONSE_INVALID')}
}
/** collect() is supplied by your external adapter, and must return the actual
 * model, observed time, answer and provider citation annotations. Persist each
 * returned eventId and payload locally before send; a lost response can be
 * retried with a NEW signature nonce and the SAME observation payload/eventId. */
export async function runConnector(config,run,collect){
 if(!run||run.manifest?.version!=='connector.v1'||!uuid.test(run.id)||!Array.isArray(run.manifest.items)||run.manifest.items.length<1||run.manifest.items.length>50)throw new Error('CONNECTOR_MANIFEST_INVALID')
 const receipts=[]
 for(const item of run.manifest.items){
  let observation
  try{observation=await collect({question:item.question,locale:item.locale,market:item.market,context:item.context,requestedModel:run.manifest.model,sampling:run.manifest.sampling})}catch{throw new Error('CONNECTOR_COLLECTION_UNAVAILABLE')}
  const payload={eventId:randomUUID(),runId:run.id,promptId:item.promptId,observedAt:observation.observedAt,actualModel:observation.actualModel,answer:observation.answer,citations:observation.citations}
  if(typeof config.retain!=='function')throw new Error('CONNECTOR_DURABLE_RETAIN_REQUIRED')
  try{await config.retain(payload)}catch{throw new Error('CONNECTOR_RETAIN_UNAVAILABLE')}
  receipts.push(await enterpriseRequest({...config,resource:'results',body:payload}))
 }
 return receipts
}
