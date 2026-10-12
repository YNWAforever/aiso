import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import type { StatusPage } from '@/components/marketing/StatusPage'
const state=vi.hoisted(()=>({primary:undefined as undefined|{onClick?:()=>void}}))
vi.mock('@/components/marketing/StatusPage',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/components/marketing/StatusPage')>()
 return {...actual,StatusPage:(props:Parameters<typeof StatusPage>[0])=>{state.primary=props.primary;return actual.StatusPage(props)}}
})
import LocalisedError from '@/app/[lang]/error'
type BoundaryProps={error:Error&{digest?:string};reset:()=>void;retry:()=>void}
it.each(['en','zh-HK'])('refreshes the failed server segment using the current Next retry contract (%s)',locale=>{
 const retry=vi.fn(),reset=vi.fn()
 const ErrorUI=LocalisedError as unknown as ComponentType<BoundaryProps>
 const error=Object.assign(new Error('synthetic private-error-marker'),{digest:'audit-synthetic-reference'})
 const html=renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale==='en'?en:zh}><ErrorUI error={error} retry={retry} reset={reset}/></NextIntlClientProvider>)
 expect(html).toContain('audit-synthetic-reference')
 expect(html).not.toContain('private-error-marker')
 expect(state.primary?.onClick).toBeTypeOf('function')
 state.primary?.onClick?.()
 expect(retry).toHaveBeenCalledTimes(1)
 expect(reset).not.toHaveBeenCalled()
})
