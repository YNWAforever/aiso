import React,{useState} from 'react'
import {NextIntlClientProvider} from 'next-intl'
import {PromptBulkPanel} from '@/components/pulse/PromptBulkPanel'
import {CitationExplorer} from '@/components/dashboard/CitationExplorer'
import {GroupedOpportunityCards} from '@/components/opportunities/GroupedOpportunityCards'
import {DraftEditor} from '@/components/work-items/DraftEditor'
import type {PromptBankItem} from '@/lib/types'
import type {CitationReport} from '@/lib/citations/report'
import type {OpportunityGroup,OpportunityResponse} from '@/lib/opportunities/types'
import type {WorkItem} from '@/lib/work-items/schema'
export type AuditLoopData={clientId:string;prompts:PromptBankItem[];report:CitationReport;groups:OpportunityGroup[];suggestions:OpportunityResponse['suggestions'];item:WorkItem}
export function AuditLoopFixture({mode,data,lang,messages}:{mode:string;data:AuditLoopData;lang:string;messages:React.ComponentProps<typeof NextIntlClientProvider>['messages']}){
 const [prompts,setPrompts]=useState(data.prompts),[open,setOpen]=useState(false),[item,setItem]=useState(data.item)
 return <NextIntlClientProvider locale={lang} messages={messages} timeZone="UTC"><main className="mx-auto max-w-5xl p-4"><h1>AISO audit fixture</h1>{mode==='bulk'?<PromptBulkPanel clientId={data.clientId} prompts={prompts} onPromptsChange={setPrompts}/>:mode==='citations'?<CitationExplorer clientId={data.clientId} report={data.report}/>:<><GroupedOpportunityCards clientId={data.clientId} groups={data.groups} suggestions={data.suggestions} onOpen={()=>setOpen(true)}/>{open&&<DraftEditor clientId={data.clientId} item={item} onSaved={setItem}/>}</>}</main></NextIntlClientProvider>
}
