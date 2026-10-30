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
import {ConversationStudio} from '@/components/dashboard/ConversationStudio';import {StudioThreads,StudioDocuments,StudioConnections,StudioTools} from '@/components/dashboard/StudioSecondaryViews';
import {savedStudioEvidence} from '@/__tests__/helpers/studio-evidence';import {resolveCommercialEntitlement} from '@/lib/tier';
import en from '@/messages/en.json';import zh from '@/messages/zh-HK.json';
const brands=[{id:'${clientId}',name:'Example Brand'},{id:'22222222-2222-4222-8222-222222222222',name:'Second Brand'}];
const entitlement=resolveCommercialEntitlement({override_plan:'pro'});const features=entitlement.features;
function App(){const accountId=React.useSyncExternalStore(cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)},()=>new URLSearchParams(location.search).get('account')||'account-a');const path=usePathname();const lang=path.split('/')[1];const clientId=path.split('/')[3];const studio=path.includes('/studio');const view=path.split('/')[5]||'';const brand=brands.find(b=>b.id===clientId)||brands[0];
const documents=new URLSearchParams(location.search).has('empty')?{items:[],truncated:false}:{items:[{id:'doc',label:'Approved brand facts',versionId:'version',versionNumber:2,approvedAt:'2026-10-28',importedAt:'2026-10-27'}],truncated:false};
const content=view==='threads'?<StudioThreads clientId={clientId}/>:view==='documents'?<StudioDocuments clientId={clientId} documents={documents} outputs={{items:[{id:'fixture-output',title:'Existing work output',revision:1,status:'draft',updatedAt:'2026-10-29'}],truncated:false}}/>:view==='connections'?<StudioConnections clientId={clientId} connection={{sourceStatus:'bound',state:{kind:'synced',dataThrough:'2026-10-26'}}}/>:view==='tools'?<StudioTools clientId={clientId} features={features} admin={false}/>:<ConversationStudio clientId={clientId} brandName={brand.name} evidence={savedStudioEvidence} sourceStatus="bound"/>;
return <NextIntlClientProvider locale={lang} messages={lang==='zh-HK'?zh:en} timeZone="UTC"><DashboardChrome conversationStudio sidebar={<DashboardSidebar profile={{display_name:'Fixture Owner'}} entitlement={entitlement} conversationStudio/>} topbar={<header data-testid="dashboard-topbar">Dashboard fixture topbar</header>}>
{studio?<StudioSessionProvider key={accountId+':'+clientId}><StudioShell clientId={clientId} brandName={brand.name} brands={brands} features={features} admin={false}>{content}</StudioShell></StudioSessionProvider>:<main data-testid="dashboard-content"><h1>{(lang==='zh-HK'?zh:en).dashboard.nav_overview}</h1><a href={'/'+lang+'/dashboard/'+clientId+'/studio'} onClick={e=>{e.preventDefault();history.pushState({},'',e.currentTarget.href);window.dispatchEvent(new PopStateEvent('popstate'))}}>Studio</a></main>}
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
