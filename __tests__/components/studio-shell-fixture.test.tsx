import { afterAll, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import { StudioDocuments, StudioConnections, StudioTools } from '@/components/dashboard/StudioSecondaryViews'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const clientId = '11111111-1111-4111-8111-111111111111'
it.each(['en', 'zh-HK'])('renders READ states and existing flow links in %s', lang => {
  const copy = (lang === 'en' ? en : zh).conversationStudio
  const missing = renderWithIntl(<StudioDocuments clientId={clientId} documents={null} outputs={null} />, lang)
  expect(missing).toContain(copy.readUnavailable)
  const docs = renderWithIntl(<StudioDocuments clientId={clientId} documents={{ items: [{ id: 'doc', label: 'Approved facts', versionId: 'version', versionNumber: 2, approvedAt: '2026-10-28', importedAt: '2026-10-27' }], truncated: true }} outputs={{ items: [{ id: 'item-id', title: 'Output title', revision: 3, status: 'draft', updatedAt: '2026-10-29' }], truncated: true }} />, lang)
  expect(docs).toContain('/work-items/item-id/versions')
  expect(docs).toContain('Approved facts')
  expect(docs).toContain(copy.evidence.documentsTruncated)
  expect(docs).toContain(copy.views.documents.outputsTruncated)
  expect(docs).not.toMatch(/<button|<form|attach=/)
  const connections = renderWithIntl(<StudioConnections clientId={clientId} connection={{ sourceStatus: 'bound', state: { kind: 'synced', dataThrough: '2026-10-26' } }} />, lang)
  expect(connections).toContain(`/${lang}/dashboard/${clientId}/assets`)
  expect(connections).toContain('2026-10-26')
  expect(connections).toContain(copy.connections.hkEndpointPending)
  expect(connections).toContain(copy.connections.disconnected)
  expect(connections).not.toMatch(/<button|<form|Harbour|WI-DEMO|fetch/)
  const tools = renderWithIntl(<StudioTools clientId={clientId} features={{}} admin={false} />, lang)
  expect(tools).not.toContain('/admin')
  expect(tools).not.toContain('?step=monitor')
  expect(tools).toContain('?step=scan')
})

// Same production components and memory provider; only the Next router transport
// is replaced. This fixture is never served as an application/auth bypass.
afterAll(async () => {
  const directory = process.env.STUDIO_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const entry = join(resolve(directory), 'shell-entry.tsx')
  const navigation = join(resolve(directory), 'navigation.tsx')
  const link = join(resolve(directory), 'link.tsx')
  writeFileSync(navigation, `import {useSyncExternalStore} from 'react';
export function navigate(href){history.pushState({},'',href);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo(0,0)}
export function usePathname(){return useSyncExternalStore(cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)},()=>location.pathname)}
export function useRouter(){return {push:navigate,refresh:()=>location.reload()}}
export function useSearchParams(){return new URLSearchParams(location.search)}
export function useParams(){const parts=usePathname().split('/');return {lang:parts[1],clientId:parts[3]}}
`)
  writeFileSync(link, `import React from 'react';import {navigate} from './navigation';export default function Link({href,onClick,prefetch,replace,scroll,...props}){return <a href={href} {...props} onClick={e=>{onClick?.(e);if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();navigate(href)}}}/>}`)
  writeFileSync(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';
import {usePathname} from 'next/navigation';import {StudioSessionProvider} from '@/components/dashboard/StudioSession';import {StudioShell} from '@/components/dashboard/StudioShell';
import {DashboardChrome} from '@/components/dashboard/shell/DashboardChrome';import {DashboardSidebar} from '@/components/dashboard/DashboardSidebar';
import {ConversationStudio} from '@/components/dashboard/ConversationStudio';import {StudioThreads,StudioDocuments,StudioConnections,StudioTools} from '@/components/dashboard/StudioSecondaryViews';import {StudioOverviewView,StudioWeeklyView} from '@/components/dashboard/StudioOverviewViews';
import {savedStudioEvidence} from '@/__tests__/helpers/studio-evidence';import {resolveCommercialEntitlement} from '@/lib/tier';
import en from '@/messages/en.json';import zh from '@/messages/zh-HK.json';

// Synthetic persistence for the offline fixture: the production provider still
// uses the real thread endpoints, so reload can prove the UI hydrates.
const studioKey=()=>{const account=new URLSearchParams(location.search).get('account')||'account-a';const client=location.pathname.split('/')[3];return 'studio-threads:'+account+':'+client};
const studioRead=()=>{try{return JSON.parse(localStorage.getItem(studioKey())||'[]')}catch{return[]}};
const studioWrite=list=>localStorage.setItem(studioKey(),JSON.stringify(list));
const studioJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const studioThread=t=>({id:t.id,title:t.title,goal:t.goal,week:t.week,kind:t.kind,sourceTitle:t.sourceTitle,turns:t.turns,createdAt:t.createdAt,updatedAt:t.updatedAt,turnCount:t.turns.length});
const studioFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{const url=typeof input==='string'?input:input.url;if(url.includes('/studio/dataforseo/settings'))return studioJson({enabled:true});if(url.includes('/studio/dataforseo'))return studioJson({snapshot:{status:'ok',locationPending:true,week:{weekStart:'2026-11-02',timeZone:'Asia/Hong_Kong',remaining:19,cap:20},locationCode:2344,languageCode:'zh-TW',keyword:'fixture',items:[]}});if(url.includes('/studio/search-console'))return studioJson({snapshot:{status:'ok',country:'hkg',completeness:'complete',window:{startDate:'2026-10-03',endDate:'2026-10-30',timeZone:'America/Los_Angeles',lagDays:3},totals:{clicks:20,impressions:500,ctr:0.04,position:4.9},topQueries:[{query:'buy widgets',clicks:5,impressions:100}]}});const match=url.match(new RegExp('/api/dashboard/clients/([^/]+)/studio/threads(?:/([^/]+))?(?:/turns)?$'));if(!match)return studioFetch(input,init);const method=(init.method||'GET').toUpperCase();const list=studioRead();if(!match[2]){if(method==='GET')return studioJson({threads:list.map(studioThread),truncated:false});const body=JSON.parse(init.body);const now=new Date().toISOString();const created={id:crypto.randomUUID(),title:body.title,goal:body.goal,week:body.week==null?null:body.week,kind:body.kind,sourceTitle:body.sourceTitle==null?null:body.sourceTitle,turns:[],createdAt:now,updatedAt:now};studioWrite([created,...list]);return studioJson({thread:studioThread(created)},201)}const found=list.find(item=>item.id===match[2]);if(!found)return studioJson({error:'NOT_FOUND'},404);if(method==='GET')return studioJson({thread:studioThread(found),turns:found.turns});if(method==='POST'){const body=JSON.parse(init.body);const turn={id:crypto.randomUUID(),position:found.turns.length,prompt:body.prompt,task:body.task==null?null:body.task,reply:body.reply,attached:body.attached==null?null:body.attached,live:null,createdAt:new Date().toISOString()};found.turns.push(turn);found.updatedAt=turn.createdAt;studioWrite(list);return studioJson({turn},201)}if(method==='PATCH'){const body=JSON.parse(init.body);const turn=found.turns.find(item=>item.position===body.position);if(!turn)return studioJson({error:'NOT_FOUND'},404);turn.live=body.live;found.updatedAt=new Date().toISOString();studioWrite(list);return studioJson({turn})}return studioJson({error:'INVALID_STUDIO_THREAD'},400)};
const brands=[{id:'${clientId}',name:'Example Brand'},{id:'22222222-2222-4222-8222-222222222222',name:'Second Brand'}];
const entitlement=resolveCommercialEntitlement({override_plan:'pro'});const features=entitlement.features;
function App(){const accountId=React.useSyncExternalStore(cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)},()=>new URLSearchParams(location.search).get('account')||'account-a');const path=usePathname();const lang=path.split('/')[1];const clientId=path.split('/')[3];const studio=path.includes('/studio');const view=path.split('/')[5]||'';const brand=brands.find(b=>b.id===clientId)||brands[0];const staff=new URLSearchParams(location.search).has('staff');
const documents=new URLSearchParams(location.search).has('empty')?{items:[],truncated:false}:{items:[{id:'doc',label:'Approved brand facts',versionId:'version',versionNumber:2,approvedAt:'2026-10-28',importedAt:'2026-10-27'}],truncated:false};
const weeks={status:'ok',data:[{week:'2026-10-26',sovScore:37.5,brandMentions:15,totalQueries:40},{week:'2026-10-19',sovScore:30,brandMentions:12,totalQueries:40},{week:'2026-10-12',sovScore:22.5,brandMentions:9,totalQueries:40}]};
const overview={visibility:{status:'ok',data:{sovScore:37.5,brandMentions:15,totalQueries:40,platformCount:3,week:'2026-10-26'}},weeks,scan:{status:'ok',data:{state:'scored',score:72,grade:'B',recordedAt:'2026-10-30T08:00:00.000Z'}},searchConsole:{status:'unbound'},opportunities:{status:'empty'}};
const content=view==='overview'?<StudioOverviewView clientId={clientId} brandName={brand.name} overview={overview}/>:view==='weekly'?<StudioWeeklyView clientId={clientId} weeks={weeks}/>:view==='threads'?<StudioThreads clientId={clientId}/>:view==='documents'?<StudioDocuments clientId={clientId} documents={documents} outputs={{items:[{id:'fixture-output',title:'Existing work output',revision:1,status:'draft',updatedAt:'2026-10-29'}],truncated:false}}/>:view==='connections'?<StudioConnections clientId={clientId} connection={{sourceStatus:'bound',state:{kind:'synced',dataThrough:'2026-10-26'}}}/>:view==='tools'?<StudioTools clientId={clientId} features={features} admin={false}/>:<ConversationStudio clientId={clientId} brandName={brand.name} evidence={savedStudioEvidence} sourceStatus="bound" staffView={staff}/>;
return <NextIntlClientProvider locale={lang} messages={lang==='zh-HK'?zh:en} timeZone="UTC"><DashboardChrome conversationStudio sidebar={<DashboardSidebar profile={{display_name:'Fixture Owner'}} entitlement={entitlement} conversationStudio/>} topbar={<header data-testid="dashboard-topbar">Dashboard fixture topbar</header>}>
{studio?<StudioSessionProvider key={accountId+':'+clientId} clientId={clientId} persist={!staff}><StudioShell clientId={clientId} brandName={brand.name} brands={staff?null:brands} features={features} admin={staff} staff={staff}>{content}</StudioShell></StudioSessionProvider>:<main data-testid="dashboard-content"><h1>{(lang==='zh-HK'?zh:en).dashboard.nav_overview}</h1><a href={'/'+lang+'/dashboard/'+clientId+'/studio'} onClick={e=>{e.preventDefault();history.pushState({},'',e.currentTarget.href);window.dispatchEvent(new PopStateEvent('popstate'))}}>Studio</a></main>}
</DashboardChrome></NextIntlClientProvider>}
createRoot(document.getElementById('root')).render(<App/>);`)
  await build({
    configFile: false, envDir: false, oxc: { jsx: { development: false } },
    resolve: { alias: { 'next/navigation': navigation, 'next/link': link, '@': resolve('.') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(directory), emptyOutDir: false, lib: { entry, name: 'StudioShellFixture', formats: ['iife'], fileName: () => 'shell-fixture.js' } },
  })
  for (const path of [entry, navigation, link]) unlinkSync(path)
})
