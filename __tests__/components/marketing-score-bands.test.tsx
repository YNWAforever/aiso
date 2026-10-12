import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('next-intl/server',()=>({getTranslations:async({locale,namespace}:{locale:string;namespace:'home'})=>createTranslator({locale,messages:locale==='zh-HK'?zh:en,namespace})}))
vi.mock('@/components/home/ScanForm',()=>({ScanForm:()=>null}))
import HomePage from '@/app/[lang]/(marketing)/page'
it.each(['en','zh-HK'])('explains fractional score bands with accessible labels (%s)',async lang=>{
 const html=renderToStaticMarkup(await HomePage({params:Promise.resolve({lang})}))
 expect(html).toContain(lang==='zh-HK'?'50 ≤ 分數 &lt; 60':'50 ≤ score &lt; 60')
 expect(html).toContain(lang==='zh-HK'?'90 ≤ 分數 ≤ 100':'90 ≤ score ≤ 100')
 expect(html).not.toContain('50–59')
 expect(html).toContain(lang==='zh-HK'?'aria-label="評級 D：50 ≤ 分數小於 60"':'aria-label="Grade D: score at least 50 and below 60"')
 expect(html).toMatch(/>74<\/p>/)
 expect(html).toMatch(/>B<\/span>/)
})
