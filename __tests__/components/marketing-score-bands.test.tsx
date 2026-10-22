import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider, createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('next-intl/server',()=>({getTranslations:async({locale,namespace}:{locale:string;namespace:string})=>createTranslator({locale,messages:locale==='zh-HK'?zh:en,namespace:namespace as never})}))
vi.mock('@/components/home/ScanForm',()=>({ScanForm:()=>null}))
import HomePage from '@/app/[lang]/(marketing)/page'
// The landing page renders client visuals, so the server output is wrapped in
// the client provider exactly as app/[lang]/layout.tsx does.
async function render(lang:'en'|'zh-HK'){
 return renderToStaticMarkup(<NextIntlClientProvider locale={lang} timeZone="UTC" messages={lang==='zh-HK'?zh:en}>{await HomePage({params:Promise.resolve({lang})})}</NextIntlClientProvider>)
}
it.each(['en','zh-HK'] as const)('explains fractional score bands with accessible labels (%s)',async lang=>{
 const html=await render(lang)
 expect(html).toContain(lang==='zh-HK'?'50 ≤ 分數 &lt; 60':'50 ≤ score &lt; 60')
 expect(html).toContain(lang==='zh-HK'?'90 ≤ 分數 ≤ 100':'90 ≤ score ≤ 100')
 expect(html).not.toContain('50–59')
 expect(html).toContain(lang==='zh-HK'?'aria-label="評級 D：50 ≤ 分數小於 60"':'aria-label="Grade D: score at least 50 and below 60"')
})
