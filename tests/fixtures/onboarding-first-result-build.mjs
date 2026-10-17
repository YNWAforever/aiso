import { mkdir, writeFile } from 'node:fs/promises'
import { compileFixtureStyles } from './result-draft-build.mjs'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

export async function writeFirstResultFixture() {
const repo = process.cwd()
const output = resolve(process.env.AISO_FIRST_RESULT_DIR || 'artifacts/onboarding-20261016/browser')
await mkdir(output, { recursive: true })
const { build } = await import(pathToFileURL(join(repo, 'node_modules/vite/dist/node/index.js')).href)
await writeFile(join(output, 'navigation.ts'), `
export function useRouter(){return{refresh(){},push(path:string){history.pushState({},'',path);document.documentElement.dataset.navigation=path;window.dispatchEvent(new Event('fixture-navigation'))}}}
export function useSearchParams(){return new URLSearchParams(location.search)}
`)
await writeFile(join(output, 'link.tsx'), `import React from 'react';export default function Link({href,children,prefetch,...props}:any){return <a href={href} {...props}>{children}</a>}`)
await writeFile(join(output, 'entry.tsx'), `
import React,{useEffect,useState} from 'react'
import{createRoot}from'react-dom/client'
import{NextIntlClientProvider}from'next-intl'
import{OnboardingWizard}from'@/components/onboarding/OnboardingWizard'
import{ScanStep}from'@/components/dashboard/ScanStep'
import{ResultsStep}from'@/components/dashboard/ResultsStep'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
function Fixture(){
 const lang=document.documentElement.lang
 const[path,setPath]=useState(location.pathname+location.search)
 useEffect(()=>{const update=()=>setPath(location.pathname+location.search);window.addEventListener('fixture-navigation',update);window.aisoFixtureReady=true;return()=>window.removeEventListener('fixture-navigation',update)},[])
 const query=new URL(path,location.origin).searchParams
 const clientId='11111111-1111-4111-8111-111111111111'
 const saved=JSON.parse(localStorage.getItem('synthetic:first-result')||'null')
 return <NextIntlClientProvider locale={lang} messages={lang==='en'?en:zh} timeZone="UTC">
 <p>SYNTHETIC FIXTURE — API and session are simulated</p>
 {path.includes('/onboarding')?<OnboardingWizard lang={lang} accountId="synthetic-first-result" scanId={new URL(path,location.origin).searchParams.get('scan')||undefined}/>:
 query.get('step')==='scan'?<ScanStep lang={lang} clientId={clientId} scan={null} scanHistory={[]}/>:
 query.get('step')==='results'&&saved?.id===query.get('scanId')?<ResultsStep scan={saved} view={saved.summaryView} lang={lang} clientId={clientId}/>:
 <p data-testid="missing-first-result">No first result route</p>}
 </NextIntlClientProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
`)
await build({
  root: repo, configFile: false, envDir: false, logLevel: 'warn',
  oxc: { jsx: { development: false } },
  resolve: { alias: {
    '@': repo, 'next/navigation': join(output, 'navigation.ts'), 'next/link': join(output, 'link.tsx'),
  } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { outDir: output, emptyOutDir: false, lib: {
    entry: join(output, 'entry.tsx'), name: 'OnboardingFirstResult', formats: ['iife'], fileName: () => 'fixture.js',
  } },
})
await compileFixtureStyles(repo, join(output, 'build.css'))
console.log('Built real onboarding/scan/result components with only navigation and API boundaries substituted.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFirstResultFixture()
}
