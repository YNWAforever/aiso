import { readPublicPortal } from '@/lib/enterprise/public-portal'
import { fetchReportLogo } from '@/lib/reports/branding'
export const dynamic='force-dynamic'
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){
 try{const query=new URL(request.url).searchParams,lang=query.get('lang')??'';query.delete('lang');const portal=await readPublicPortal((await params).slug,lang,query);if(!portal?.logoUrl)return new Response(null,{status:404});const logo=await fetchReportLogo(portal.logoUrl);return new Response(new Uint8Array(logo.bytes),{headers:{'Content-Type':logo.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})}catch{return new Response(null,{status:404})}
}
