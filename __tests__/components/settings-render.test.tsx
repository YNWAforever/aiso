import { afterAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SettingsView } from '@/components/dashboard/SettingsView'
import { getPlanDefinition } from '@/lib/plans/catalog'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
const states=['unknown','active','trialing','past_due','cancelled'] as const
const render=(lang:string,status:typeof states[number])=>renderToStaticMarkup(<SettingsView lang={lang} plan={status==='unknown'?'free':'pro'} status={status} hasStripe={status!=='unknown'}/>)
describe('localized settings presentation',()=>{
 it.each(['en','zh-HK'])('shows explicit localized status and real catalogue in %s',lang=>{
  const copy=(lang==='en'?en:zh).settings
  for(const status of states){
   const html=render(lang,status)
   expect(html).toContain(copy.statusLabels[status])
   expect(html).toContain(copy.title)
   if(status==='unknown'){expect(html).not.toContain('/api/stripe/portal');expect(html).toContain(copy.billingUnavailable)}
   else{expect(html).toContain('href="/api/stripe/portal"');expect(html).toContain(String(getPlanDefinition('pro').monthlyPriceUsd))}
  }
 })
 it('uses an ordinary billing anchor and retains the pricing destination',()=>{
  const source=readFileSync('components/dashboard/SettingsView.tsx','utf8')
  expect(source).toMatch(/<a[\s\S]*?href="\/api\/stripe\/portal"/)
  expect(source).not.toMatch(/<Link[\s\S]*?href="\/api\/stripe\/portal"/)
  expect(render('zh-HK','active')).toContain('href="/zh-HK/pricing"')
 })
})
afterAll(()=>{
 const dir=process.env.C8G_HTML_DIR;if(!dir)return;mkdirSync(dir,{recursive:true})
 for(const lang of ['en','zh-HK']){
  writeFileSync(join(dir,`${lang}-copy.json`),JSON.stringify((lang==='en'?en:zh).settings),'utf8')
  for(const status of states)writeFileSync(join(dir,`${lang}-${status}.html`),render(lang,status),'utf8')
 }
})
