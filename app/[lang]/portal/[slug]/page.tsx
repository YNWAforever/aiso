import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { readPublicPortal } from '@/lib/enterprise/public-portal'
import { EnterpriseReportView } from '@/components/enterprise/EnterpriseReportView'
export const dynamic='force-dynamic'
export const metadata:Metadata={robots:{index:false,follow:false},referrer:'no-referrer'}
export default async function PortalPage({params,searchParams}:{params:Promise<{lang:string;slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const{lang,slug}=await params,raw=await searchParams,query=new URLSearchParams()
 for(const[key,value]of Object.entries(raw)){if(Array.isArray(value))notFound();if(value!==undefined)query.set(key,value)}
 const portal=await readPublicPortal(slug,lang,query);if(!portal)notFound()
 return <EnterpriseReportView snapshot={portal.snapshot} lang={lang}/>
}
