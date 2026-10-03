import { afterAll,expect,it,vi } from 'vitest'
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}})}))
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { SourcePackWorkspace } from '@/components/sources/SourcePackWorkspace'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { sourceClientId,sourcePageFixture } from './source-maintenance-fixtures'
import { writeC9cFixture } from './c9c-fixture-writer'
const page=sourcePageFixture(),props={clientId:sourceClientId,pack:page.pack,page}
const html=(lang:string)=>renderToString(<NextIntlClientProvider locale={lang} timeZone="UTC" messages={lang==='en'?en:zh}><SourcePackWorkspace {...props}/></NextIntlClientProvider>)
it.each(['en','zh-HK'])('T12 first page shows fifty of 201 with separate import limits in %s',lang=>{
 const body=html(lang)
 expect(body).toContain('201');expect(body).toContain('262144');expect(body).toContain('4000');expect(body).not.toContain('Source 51')
})
afterAll(()=>writeC9cFixture('AISO_SOURCES','SourcePackWorkspace','@/components/sources/SourcePackWorkspace',props,html,{},'sources'))
