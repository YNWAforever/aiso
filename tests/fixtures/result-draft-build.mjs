import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export async function writeResultDraftFixture() {
  const repo = process.cwd(), output = resolve(process.env.AISO_RESULT_DRAFT_DIR || 'artifacts/result-to-draft-20261017/browser')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'entry.tsx'), `
import React,{useEffect,useState}from'react'
import{createRoot}from'react-dom/client'
import{NextIntlClientProvider}from'next-intl'
import{ResultsStep}from'@/components/dashboard/ResultsStep'
import{ScanStep}from'@/components/dashboard/ScanStep'
import{OnboardingWizard}from'@/components/onboarding/OnboardingWizard'
import{OpportunityWorkspace}from'@/components/opportunities/OpportunityWorkspace'
import{VersionWorkspace}from'@/components/change-sets/VersionWorkspace'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import d from './data.json'
function Fixture(){
 const lang=document.documentElement.lang
 const scenario=new URLSearchParams(location.search).get('case')
 const opportunities=scenario==='priorities'?d.priorities:scenario==='empty'?{...d.opportunities,suggestions:[],sourceStates:{pulse:'empty',scan:'empty'}}:
 scenario==='attached'?{...d.opportunities,suggestions:d.opportunities.suggestions.map((s,i)=>i===0?{...s,savedDraftId:d.drafts.en.id,savedState:'saved'}:s)}:d.opportunities
 const result=scenario==='provider-failed'?{...d.result,results:{...d.result.results,_n8n:d.failedReceipt}}:
 scenario==='coverage'?d.coverageResult:scenario==='failed-evidence'?d.failedResult:scenario==='unknown-evidence'?d.unknownResult:
 scenario==='score-missing'?{...d.result,score:null,grade:null}:d.result
 const summaryView=scenario==='coverage'?d.coverageView:scenario==='failed-evidence'?d.failedView:scenario==='unknown-evidence'?d.unknownView:
 scenario==='score-missing'?{...d.summaryView,score:null,grade:null,state:'unknown'}:d.summaryView
 const[v,setV]=useState(null)
 const review=location.pathname.includes('/versions')
 useEffect(()=>{window.aisoDraftFixtureReady=true;if(review)Promise.all([
 fetch('/api/clients/'+d.clientId+'/work-items/'+d.drafts.en.id).then(r=>r.json()),
 fetch('/api/clients/'+d.clientId+'/work-items/'+d.drafts.en.id+'/versions').then(r=>r.json())
 ]).then(([a,b])=>setV({draft:a.item,history:b}))},[])
 return <NextIntlClientProvider locale={lang} messages={lang==='en'?en:zh} timeZone="UTC">
 <p>SYNTHETIC FIXTURE — no live AI, account or database</p>
 {location.pathname.endsWith('/onboarding')?<OnboardingWizard lang={lang} accountId="11111111-1111-4111-8111-111111111119"/>:
 review?(v?<VersionWorkspace clientId={d.clientId} workItemId={d.drafts.en.id} initialDraft={v.draft} initial={v.history} returnScanId={new URLSearchParams(location.search).get('scanId')??undefined}/>:<p>Loading fixture</p>):
 location.search.includes('step=scan')?<ScanStep clientId={d.clientId} lang={lang} scan={null} scanHistory={[]}/>:
 location.search.includes('step=improve')?<OpportunityWorkspace clientId={d.clientId} scanId={d.scanId} initial={opportunities}/>:
 <main><ResultsStep scan={result} view={summaryView} brandName="Synthetic Browser Brand" clientId={d.clientId} lang={lang}/></main>}
 </NextIntlClientProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/>)
`)
  await writeFile(join(output, 'link.tsx'), `import React from'react';export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`)
  await writeFile(join(output, 'navigation.ts'), `export function useRouter(){return{refresh(){},push(url){location.assign(url)}}}export function useSearchParams(){return new URLSearchParams(location.search)}`)
  const { build } = await import(pathToFileURL(join(repo, 'node_modules/vite/dist/node/index.js')).href)
  await build({ root: repo, configFile: false, envDir: false, logLevel: 'warn',
    oxc: { jsx: { development: false } },
    resolve: { alias: { '@': repo, 'next/link': join(output, 'link.tsx'), 'next/navigation': join(output, 'navigation.ts') } },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: output, emptyOutDir: false, lib: { entry: join(output, 'entry.tsx'), name: 'ResultDraftFixture', formats: ['iife'], fileName: () => 'fixture.js' } } })
  await compileFixtureStyles(repo, join(output, 'build.css'))
}
export async function compileFixtureStyles(repo, output) {
  // Compile the real app stylesheet directly; no dev server or .env is loaded.
  const { default: postcss } = await import('postcss')
  const { default: tailwind } = await import('@tailwindcss/postcss')
  const from = join(repo, 'app/globals.css')
  const css = await postcss([tailwind({ base: repo })]).process(await readFile(from, 'utf8'), { from })
  await writeFile(output, css.css)
}
