'use client'
import {useRef,useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import type {PromptBankItem} from '@/lib/types'
import type {PromptBatchRow,PromptBatchPreview} from '@/lib/prompts/bulk'
import {PROMPT_MARKETS} from '@/lib/prompts/context'
type Preview=PromptBatchPreview
const ERROR_GUIDANCE:Record<string,string>={DUPLICATE_PROMPT:'qb_bulk_fix_duplicate',INVALID_CATEGORY:'qb_bulk_fix_category',MARKET_REQUIRED:'qb_bulk_fix_market',INVALID_LANGUAGE:'qb_bulk_fix_language',INVALID_QUESTION:'qb_bulk_fix_question',INVALID_ACTIVE:'qb_bulk_fix_active',INVALID_OWNED_ID:'qb_bulk_fix_id',PROMPT_LIMIT_REACHED:'qb_bulk_fix_limit'}
export function PromptBulkPanel({clientId,prompts,onPromptsChange}:{clientId:string;prompts:PromptBankItem[];onPromptsChange:(p:PromptBankItem[])=>void}){
 const t=useTranslations('pulse'),lang=useLocale(),[selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState(''),[sort,setSort]=useState('question'),[csv,setCsv]=useState(''),[language,setLanguage]=useState(''),[market,setMarket]=useState(''),[active,setActive]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[recent,setRecent]=useState<Record<string,{runId:string;week:string;expected:number;succeeded:number;classified:number}>>({});const pending=useRef(false),intent=useRef<string|null>(null),uncertainFlag=useRef(false)
 const endpoint=`/api/dashboard/clients/${clientId}/prompts/bulk`,visible=prompts.filter(p=>p.question.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>sort==='language'?String(a.language).localeCompare(String(b.language))||a.id.localeCompare(b.id):a.question.localeCompare(b.question)||a.id.localeCompare(b.id))
 async function load(){const response=await fetch(endpoint,{cache:'no-store'});if(!response.ok)throw new Error('load');const body=await response.json();setRecent(body.recent??{});return body}
 async function prepare(importCsv:boolean){
  if(pending.current||uncertainFlag.current)return
  pending.current=true;setBusy(true);setError('');setPreview(null)
  try{
   const current=await load()
   const rows=importCsv?undefined:(current.prompts as PromptBatchRow[]).filter(p=>selected.includes(p.id!)).map(p=>({...p,...(language?{language}:{}),...(market?{market}:{}),...(active?{is_active:active==='true'}:{})}))
   if(!importCsv&&(!rows!.length||rows!.length!==selected.length))throw new Error('selection')
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'preview',...(importCsv?{csv}:{rows})})})
   if(!response.ok)throw new Error('preview')
   const result=await response.json() as Preview
   if(result.version!==current.version)throw new Error('conflict')
   if(!result.summary||!Array.isArray(result.validRows)||!Array.isArray(result.errors))throw new Error('preview')
   intent.current=crypto.randomUUID();setPreview(result)
  }catch(error){setError(t(error instanceof Error&&error.message==='conflict'?'qb_bulk_conflict':'qb_bulk_failed'))}
  finally{pending.current=false;setBusy(false)}
 }
 async function save(){
  if(pending.current||!preview||preview.errors.length||!intent.current)return
  pending.current=true;setBusy(true);setError('')
  try{
   // The store checks the scoped original intent before any possible write.
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intentKey:intent.current,expectedVersion:preview.version,changes:preview.validRows})})
   if(!response.ok){
    if(response.status>=500){uncertainFlag.current=true;setUncertain(true);setError(t('qb_bulk_unknown'));return}
    const body=await response.json()
    if(body.error?.includes('CONFLICT')){setPreview(null);intent.current=null;uncertainFlag.current=false;setUncertain(false);setError(t('qb_bulk_conflict'))}
    else setError(t('qb_bulk_failed'))
    return
   }
   const result=await response.json()
   if(!result||!Array.isArray(result.updatedIds))throw new Error('unknown receipt')
   const current=await load();onPromptsChange(current.prompts)
   setPreview(null);setSelected([]);setCsv('');intent.current=null;uncertainFlag.current=false;setUncertain(false)
  }catch{uncertainFlag.current=true;setUncertain(true);setError(t('qb_bulk_unknown'))}
  finally{pending.current=false;setBusy(false)}
 }
 return<details className="mb-5 rounded-xl border border-border p-4" onToggle={event=>{if(event.currentTarget.open)void load().catch(()=>setError(t('qb_bulk_failed')))}}><summary className="min-h-11 font-semibold">{t('qb_bulk_title')}</summary><div className="space-y-3" aria-busy={busy}>
 <p>{t('qb_bulk_scope',{count:selected.length})}</p><p className="text-xs">{t('qb_bulk_frozen')}</p>
 <label className="block">{t('qb_bulk_filter')}<input className="block min-h-11 w-full rounded border px-2" value={filter} disabled={busy||uncertain} onChange={e=>setFilter(e.target.value)}/></label><label>{t('qb_bulk_sort')}<select className="min-h-11 rounded border px-2" value={sort} disabled={busy||uncertain} onChange={e=>setSort(e.target.value)}><option value="question">{t('qb_bulk_question')}</option><option value="language">{t('qb_language')}</option></select></label>
 <button type="button" className="min-h-11 underline" disabled={busy||uncertain} onClick={()=>{setPreview(null);setSelected([...new Set([...selected,...visible.map(p=>p.id)])])}}>{t('qb_bulk_select_visible',{count:visible.length})}</button><button type="button" className="min-h-11 underline" disabled={busy||uncertain} onClick={()=>{setPreview(null);setSelected([])}}>{t('qb_bulk_clear')}</button>
 <ul className="max-h-80 overflow-y-auto">{visible.map(p=><li key={p.id} className="border-b py-2"><label className="flex min-h-11 items-start gap-2"><input type="checkbox" className="mt-2 size-5" checked={selected.includes(p.id)} onChange={e=>{setPreview(null);setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}} disabled={busy||uncertain}/><span className="min-w-0 break-words">{p.question}<span className="block text-xs">{p.language??t('qb_unknown_context')} · {p.market??t('qb_unspecified_market')}</span></span></label>{recent[p.id]?<a className="min-h-11 text-xs underline" href={`/${lang}/dashboard/${clientId}/observations?promptId=${p.id}&run=${recent[p.id].runId}&week=${recent[p.id].week}`}>{recent[p.id].week} · {t('qb_bulk_coverage',{...recent[p.id]})}</a>:<span className="text-xs">{t('qb_bulk_run_unknown')}</span>}</li>)}</ul>
 <div className="flex flex-wrap gap-3"><label>{t('qb_language')}<select className="block min-h-11 border" value={language} disabled={busy||uncertain} onChange={e=>{setLanguage(e.target.value);setPreview(null)}}><option value="">{t('qb_bulk_keep')}</option><option value="en">English</option><option value="zh-HK">繁體中文</option></select></label><label>{t('qb_market')}<select className="block min-h-11 border" value={market} disabled={busy||uncertain} onChange={e=>{setMarket(e.target.value);setPreview(null)}}><option value="">{t('qb_bulk_keep')}</option>{PROMPT_MARKETS.map(m=><option key={m.value} value={m.value}>{lang==='zh-HK'?m.labelZh:m.labelEn}</option>)}</select></label><label>{t('qb_bulk_active')}<select className="block min-h-11 border" value={active} disabled={busy||uncertain} onChange={e=>{setActive(e.target.value);setPreview(null)}}><option value="">{t('qb_bulk_keep')}</option><option value="true">{t('qb_bulk_enable')}</option><option value="false">{t('qb_bulk_disable')}</option></select></label></div>
 <button type="button" className="min-h-11 underline" disabled={busy||uncertain||!selected.length} onClick={()=>void prepare(false)}>{t('qb_bulk_preview_selected')}</button>
 <p className="text-xs">{t('qb_bulk_guidance')}</p><a className="inline-flex min-h-11 items-center underline" download="aiso-question-sample.csv" href={'data:text/csv;charset=utf-8,'+encodeURIComponent('question,category,language,market,is_active\n'+['brand_query','category_query','intent_query','pain_point'].map((category,i)=>'Synthetic sample question '+(i+1)+','+category+','+lang+',HK,true').join('\n'))}>{t('qb_bulk_sample')}</a>\n <label className="block">{t('qb_bulk_csv')}<textarea className="block min-h-32 w-full rounded border p-2" maxLength={65536} value={csv} disabled={busy||uncertain} onChange={e=>{setCsv(e.target.value);setPreview(null)}} placeholder="question,category,language,market,is_active"/></label><button type="button" className="min-h-11 underline" disabled={busy||uncertain||!csv.trim()} onClick={()=>void prepare(true)}>{t('qb_bulk_preview_csv')}</button>
 {preview&&<section aria-label={t('qb_bulk_preview')}>
 <p>{t('qb_bulk_summary',preview.summary)}</p>
 <p>{t(uncertain||busy?'qb_bulk_projection_unknown':'qb_bulk_projection',{active:preview.activeAfter})}</p>
 {preview.errors.length>0&&<ul role="alert">{preview.errors.map((e,i)=><li key={i} className="mb-2">
 <p>{t('qb_bulk_row_guidance',{row:e.row,reason:t(ERROR_GUIDANCE[e.code]??'qb_bulk_fix_row')})}</p>
 <p className="text-xs text-muted-foreground">{t('qb_bulk_row_error',{row:e.row,field:e.field,code:e.code})}</p>
 </li>)}</ul>}
 <ol className="max-h-64 overflow-y-auto">{preview.validRows.map((r,i)=><li key={i}>{r.question} · {r.language} · {r.market} · {r.is_active?t('qb_bulk_enable'):t('qb_bulk_disable')}</li>)}</ol>
 <button type="button" className="min-h-11 rounded bg-primary px-3 text-primary-foreground" disabled={busy||!!preview.errors.length||!preview.validRows.length} onClick={()=>void save()}>{t('qb_bulk_confirm')}</button>
 </section>}{error&&<p role="alert">{error}</p>}
 </div></details>
}
