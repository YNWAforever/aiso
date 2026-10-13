'use client'
import { useEffect, useRef, useState } from 'react'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import {trackFunnelEvent} from '@/lib/funnel-client'
import { Sparkles } from 'lucide-react'
import { INDUSTRY_CODES, industryLabel } from '@/lib/onboarding/industry'
import { PROMPT_MARKETS, type PromptLanguage } from '@/lib/prompts/context'
import type { BrandDraft } from '@/lib/onboarding/brand-draft'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

type AssistantContext = { url: string; language: PromptLanguage | ''; market: string }
type Props = {
  lang: string; context: AssistantContext; onContextChange: (context: AssistantContext) => void;
  onApply: (draft: BrandDraft) => void; onManual: () => void;
}
export function BrandAssistant(props: Props) {
  const { lang } = props
  return <NextIntlClientProvider locale={lang} messages={{ brandAssistant: (lang === 'zh-HK' ? zh : en).brandAssistant }} timeZone="UTC">
    <AssistantForm {...props} />
  </NextIntlClientProvider>
}
function AssistantForm({ lang, context, onContextChange, onApply, onManual }: Props) {
  const t = useTranslations('brandAssistant')
  const { url, language, market } = context
  const contextKey=JSON.stringify([url,language,market])
  type AssistantState={key:string;draft:BrandDraft|null;busy:boolean;error:string}
  const [state,setState]=useState<AssistantState>({key:contextKey,draft:null,busy:false,error:''})
  const active=state.key===contextKey?state:{key:contextKey,draft:null,busy:false,error:''}
  const {draft,busy,error}=active
  function patch(values:Partial<Omit<AssistantState,'key'>>){
    setState(current=>({... (current.key===contextKey?current:{key:contextKey,draft:null,busy:false,error:''}),...values,key:contextKey}))
  }
  const setDraft=(draft:BrandDraft|null)=>patch({draft})
  const setBusy=(busy:boolean)=>patch({busy})
  const setError=(error:string)=>patch({error})
  const controller=useRef<AbortController|null>(null),generation=useRef(0),latestContext=useRef(contextKey)
  useEffect(()=>{
    latestContext.current=contextKey;generation.current++
    controller.current?.abort();controller.current=null
  },[contextKey])
  useEffect(() => () => {generation.current++;controller.current?.abort()}, [])
  function changeContext(next:AssistantContext){
    generation.current++;controller.current?.abort();controller.current=null
    setBusy(false);setDraft(null);onContextChange(next)
  }
  function takeManual(){
    generation.current++;controller.current?.abort();controller.current=null
    setBusy(false);setDraft(null);setError('');trackFunnelEvent({name:'onboarding_manual_selected',locale:lang==='zh-HK'?'zh-HK':'en'});onManual()
  }
  const field = 'mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'
  async function suggest(event: React.FormEvent) {
    event.preventDefault()
    if (controller.current || !url.trim() || !language || !market) return
    trackFunnelEvent({name:'brand_draft_requested',locale:lang==='zh-HK'?'zh-HK':'en'})
    const request = new AbortController(),version=++generation.current,key=contextKey
    controller.current=request;setBusy(true);setError('');setDraft(null)
    try {
      const response = await fetch('/api/onboarding/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, language, market }), signal: request.signal })
      if (!response.ok) { if(generation.current===version)setError(t(response.status === 429 ? 'limit' : 'unavailable')); return }
      const result = await response.json() as BrandDraft
      if(typeof result.brandName!=='string'||typeof result.description!=='string'||!result.domain
        ||((!result.brandName||!result.description)&&result.reviewRequired!==true)
        ||result.language!==language||result.market!==market)throw new Error('Invalid draft')
      if (!request.signal.aborted&&generation.current===version&&latestContext.current===key){
        const evidence=Array.isArray(result.evidence)?result.evidence.filter(e=>e&&['brandName','description','industry'].includes(e.field)&&typeof e.quote==='string'&&e.quote.length>0&&e.quote.length<=240).slice(0,6):[]
        setDraft({...result,evidence})
      }
    } catch { if (!request.signal.aborted&&generation.current===version) setError(t('unavailable')) }
    finally { if(controller.current===request){controller.current=null;setBusy(false)} }
  }
  return <section aria-labelledby="brand-assist-title" className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
    <h2 id="brand-assist-title" className="flex items-center gap-2 font-semibold"><Sparkles aria-hidden="true" className="size-4" />{t('title')}</h2>
    <p className="mt-2 text-sm text-muted-foreground">{t('intro')}</p>
    {!draft ? <form onSubmit={suggest} className="mt-4 space-y-3" aria-busy={busy}>
      <label className="block text-sm" htmlFor="brand-assist-url">{t('website')}<input id="brand-assist-url" value={url} maxLength={2048} onChange={e => changeContext({ ...context, url: e.target.value })} placeholder="example.com" className={field} required /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm" htmlFor="brand-assist-language">{t('language')}<select id="brand-assist-language" value={language} onChange={e => changeContext({ ...context, language: e.target.value as PromptLanguage | '' })} className={field} required>
          <option value="">{t('choose')}</option><option value="en">English</option><option value="zh-HK">繁體中文（香港）</option>
        </select></label>
        <label className="block text-sm" htmlFor="brand-assist-market">{t('market')}<select id="brand-assist-market" value={market} onChange={e => changeContext({ ...context, market: e.target.value })} className={field} required>
          <option value="">{t('choose')}</option>{PROMPT_MARKETS.map(m => <option key={m.value} value={m.value}>{lang === 'zh-HK' ? m.labelZh : m.labelEn}</option>)}
        </select></label>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('disclosure')}</p>
      <button type="submit" disabled={busy || !url.trim() || !language || !market} className="min-h-11 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? t('loading') : t('generate')}</button>
      {busy && <p role="status" className="text-sm">{t('loading')}</p>}
    </form> : <div className="mt-4 space-y-3">
      <p role="status" className="text-sm font-semibold">{t('review')}</p>
      <p className="break-all text-xs text-muted-foreground">{t('source')}: {draft.sourceUrl}</p>
      <p className="break-all text-xs text-muted-foreground">{t('fetchedAt')}: <time dateTime={draft.fetchedAt}>{draft.fetchedAt}</time></p>
      <section aria-label={t('evidenceTitle')} className="space-y-2 rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">{t('evidenceTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('evidenceNote')}</p>
        {draft.evidence?.length?<ul className="space-y-2">{draft.evidence.map((e,index)=><li key={index}>
          <p className="text-xs font-semibold">{t(({brandName:'name',description:'description',industry:'industry'} as const)[e.field])}</p>
          <blockquote className="break-words border-l-2 border-border pl-3 text-sm">{e.quote}</blockquote>
        </li>)}</ul>:<p className="text-sm">{t('missingEvidence')}</p>}
      </section>
      <label className="block text-sm" htmlFor="brand-draft-name">{t('name')}<input id="brand-draft-name" value={draft.brandName} maxLength={160} onChange={e => setDraft({ ...draft, brandName: e.target.value })} className={field} /></label>
      <label className="block text-sm" htmlFor="brand-draft-description">{t('description')}<textarea id="brand-draft-description" rows={3} maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className={field} /></label>
      <label className="block text-sm" htmlFor="brand-draft-industry">{t('industry')}<select id="brand-draft-industry" value={draft.industry ?? ''} onChange={e => setDraft({ ...draft, industry: (e.target.value || null) as BrandDraft['industry'] })} className={field}>
        <option value="">{t('unknown')}</option>{INDUSTRY_CODES.map(i => <option key={i} value={i}>{industryLabel(i, lang)}</option>)}
      </select></label>
      <p className="text-xs text-muted-foreground">{t('reviewNote')}</p>
      <button type="button" disabled={!draft.brandName.trim()} onClick={() => {trackFunnelEvent({name:'brand_draft_reviewed',locale:lang==='zh-HK'?'zh-HK':'en'});onApply(draft)}} className="min-h-11 w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{t('apply')}</button>
      <button type="button" onClick={() => setDraft(null)} className="min-h-11 w-full rounded-lg border border-border px-4 py-3 text-sm">{t('change')}</button>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <p className="mt-4 text-xs text-muted-foreground">{t('manual')}</p>
    {<button type="button" onClick={takeManual} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm font-semibold">{t('manualAction')}</button>}
  </section>
}
