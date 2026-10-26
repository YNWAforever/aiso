import 'server-only'
import { createHash } from 'node:crypto'
import { parse } from 'parse5'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'
import { canonicalOutcomeUrl } from '@/lib/outcome-integrations/input'
const pageFetch = createPublicUrlFetcher({ allowedProtocols:['https:'],maxRedirects:0,maxResponseBytes:262144,timeoutMs:5000 })
type Node = { nodeName:string;attrs?:{name:string;value:string}[];childNodes?:Node[];value?:string }
export type VisibilityPage = {url:string;observedAt:string;method:'visibility-page.v1';collection:'complete'|'failed'|'unsupported';httpStatus:number|null;canonicalState:'present'|'missing'|'different'|'unverifiable';noindex:boolean|null;titlePresent:boolean|null;contentHash:string|null;limitations:string[]}
export async function validateVisibilityPage(input:string,domain:string,fetcher:PublicUrlFetch=pageFetch):Promise<VisibilityPage> {
  const url = canonicalOutcomeUrl(input,domain)
  const evidence:VisibilityPage = {url,observedAt:new Date().toISOString(),method:'visibility-page.v1',collection:'failed',httpStatus:null,canonicalState:'unverifiable',noindex:null,titlePresent:null,contentHash:null,limitations:['raw-html-only','no-redirects','no-page-excerpts','no-ranking-inference']}
  try {
    const response = await fetcher(url)
    evidence.httpStatus=response.status
    if (!response.ok) { await response.body?.cancel();return evidence }
    if (!['text/html','application/xhtml+xml'].includes(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()??'')) {
      await response.body?.cancel();return {...evidence,collection:'unsupported'}
    }
    const html=await response.text()
    if(Buffer.byteLength(html)>262144)return evidence
    const tree=parse(html) as unknown as Node,canonicals:string[]=[]
    let titlePresent=false,noindex=/(?:^|[\s,:])noindex(?:$|[\s,])/.test(response.headers.get('x-robots-tag')?.toLowerCase()??'')
    function walk(node:Node) {
      const attrs=Object.fromEntries((node.attrs??[]).map(attr=>[attr.name,attr.value]))
      if(node.nodeName==='link'&&attrs.rel?.toLowerCase().split(/\s+/).includes('canonical'))canonicals.push(attrs.href??'')
      if(node.nodeName==='meta'&&attrs.name?.toLowerCase()==='robots'&&attrs.content?.toLowerCase().split(/[\s,]+/).includes('noindex'))noindex=true
      if(node.nodeName==='title'&&node.childNodes?.some(child=>child.value?.trim()))titlePresent=true
      for(const child of node.childNodes??[])walk(child)
    }
    walk(tree)
    let canonicalState:VisibilityPage['canonicalState']='missing'
    if(canonicals.length) {
      canonicalState='unverifiable'
      if(canonicals.length===1&&canonicals[0])try { canonicalState=new URL(canonicals[0],url).href===url?'present':'different' }catch{}
    }
    return {...evidence,observedAt:new Date().toISOString(),collection:'complete',canonicalState,noindex,titlePresent,contentHash:createHash('sha256').update(html).digest('hex')}
  }catch{return evidence}
}
