'use client'
import {useEffect,useRef,useState} from 'react'
import { useTranslations } from 'next-intl'
import {useParams,useRouter} from 'next/navigation'
import { AgentSection } from '@/components/dashboard/AgentSection'
import { AgentRecommendations } from '@/components/dashboard/AgentRecommendations'
import { AgentProgress } from '@/components/dashboard/AgentProgress'
import { AgentCompetitors } from '@/components/dashboard/AgentCompetitors'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { PLAN_CATALOG } from '@/lib/plans/catalog'
import type { Scan, AgentRecommendation, AgentProgress as AgentProgressType, AgentCompetitor } from '@/lib/types'
import {readAgentGeneration,type AgentGenerationReceipt} from '@/lib/agents/generation-state'
import {normalizeAgentNumbers} from '@/lib/workspace/agent-numbers'
import {runtimePlatformsFor} from '@/lib/pulse/platforms'

type Props = {
  scan: Scan
  features: import('@/lib/types').PlanFeatures
  recommendations: AgentRecommendation[]
  progress: AgentProgressType[]
  competitors: AgentCompetitor[]
}
type Attempt={state:'pending'|'running'|'complete'|'error'|'unavailable';generation?:AgentGenerationReceipt|null;checking?:boolean}
function numericRows<T extends object>(rows:T[],section:Parameters<typeof normalizeAgentNumbers>[1]):T[]{
  return rows.flatMap(row=>{try{return[normalizeAgentNumbers(row,section)]}catch{return[]}})
}
const limitationCopy:Record<string,'basisOriginOnly'|'basisNoExcerpts'|'basisSinglePage'|'basisRetention'>={
  'origin-only-identity':'basisOriginOnly','no-page-or-provider-excerpts':'basisNoExcerpts',
  'sampled-single-page':'basisSinglePage','scan-record-retention':'basisRetention',
}
function recommendationBasis(receipt:AgentGenerationReceipt|null,scanId:string){
  return (Array.isArray(receipt?.recommendationBasis)?receipt.recommendationBasis:[]).filter(item=>
    item&&typeof item.checkId==='string'&&receipt?.sourceCheckIds.includes(item.checkId)
    &&['warn','fail'].includes(item.assessment)&&typeof item.action==='string'&&item.action.trim()
    &&item.source?.scanId===scanId&&item.source.checkId===item.checkId
    &&Array.isArray(item.limitations)&&item.limitations.every(value=>typeof value==='string'))
}
function classifiedSamples(receipt:AgentGenerationReceipt|null,platforms:string[]){
  const allowed=new Set([...platforms,...runtimePlatformsFor(platforms)])
  return (Array.isArray(receipt?.progressSamples)?receipt.progressSamples:[]).filter(item=>
    item&&allowed.has(item.platform)&&typeof item.week==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.week)
    &&Number.isSafeInteger(item.classified)&&item.classified>0&&Number.isSafeInteger(item.mentioned)
    &&item.mentioned>=0&&item.mentioned<=item.classified)
}

export function ImproveStep({ scan, features, recommendations, progress, competitors }: Props) {
  const t = useTranslations('dashboard')
  const generated=useTranslations('generatedWork')
  const {clientId}=useParams<{clientId:string}>()
  const router=useRouter()
  const key=`${clientId}:${scan.id}`
  const [attempts,setAttempts]=useState<Record<string,Attempt>>({})
  const pending=useRef(new Set<string>())
  const active=useRef<string|null>(key)
  useEffect(()=>{active.current=key;return()=>{active.current=null}},[key])
  const saved=readAgentGeneration(scan.results?._agent_generation)
  const attempt=attempts[key]
  const receipt=saved?.state==='complete'?saved:attempt?.generation??saved
  const status=saved?.state==='complete'?'complete':attempt?.state??receipt?.state??scan.agent_status
  const loading=attempt?.state==='pending'
  const checkStatus=status==='running'||status==='complete'||receipt?.providerStarted===true
  const basis=recommendationBasis(receipt,scan.id)
  const samples=classifiedSamples(receipt,features.platform_access)
  const allowedRecs = numericRows(recommendations.filter(r => features.platform_access.includes(r.platform)),'recommendations')
  const measuredProgress=numericRows(progress,'progress')
  const measuredCompetitors=numericRows(competitors,'competitors')
  const hasOutput=features.agent_recs&&allowedRecs.length>0||features.agent_progress&&measuredProgress.length>0||features.agent_competitors&&measuredCompetitors.length>0
  const proPrice = `$${PLAN_CATALOG.pro.monthlyPriceUsd}/month`
  const enterprisePrice = `$${PLAN_CATALOG.enterprise.monthlyPriceUsd}/month`

  async function generate(){
    if(pending.current.has(key))return
    if(status==='complete'){router.refresh();return}
    pending.current.add(key)
    // The native endpoint reconciles saved claims using this same scan identity;
    // it never mints a new generation intent for a status check.
    setAttempts(current=>({...current,[key]:{state:'pending',generation:receipt,checking:checkStatus}}))
    try{
      const response=await fetch(`/api/clients/${encodeURIComponent(clientId)}/agents/generate`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scanId:scan.id}),
      })
      const data:unknown=await response.json()
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Unavailable generation')
      const result=data as Record<string,unknown>
      if(result.scanId!==scan.id||!['complete','running','unavailable','error'].includes(String(result.state)))throw new Error('Unavailable generation')
      const generation=readAgentGeneration(result.generation)
      if(result.generation!=null&&!generation||generation&&generation.state!==result.state||!response.ok&&result.state!=='error'&&result.state!=='unavailable')throw new Error('Unavailable generation')
      setAttempts(current=>({...current,[key]:{state:result.state as Attempt['state'],generation}}))
      if(active.current===key&&(result.state==='complete'||result.state==='running'))router.refresh()
    }catch{
      setAttempts(current=>({...current,[key]:{state:'error',generation:receipt}}))
    }finally{pending.current.delete(key)}
  }

  return (
    <div className="space-y-4">
      {features.agent_recs&&typeof clientId==='string'?<div className="rounded-xl border border-dash-border bg-dash-surface p-5" aria-busy={loading}>
        <button type="button" onClick={generate} disabled={loading} className="min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
          {loading?generated(attempt?.checking?'checkingStatus':'generating'):status==='complete'?generated('refreshStatus'):checkStatus?generated('checkStatus'):status==='error'?generated('retry'):generated('generateImprove')}
        </button>
        <p className="mt-2 text-xs text-dash-muted">{generated('improveActionNotice')}</p>
      </div>:null}
      {receipt?<ul className="space-y-2 rounded-xl border border-dash-border bg-dash-surface p-5 text-sm text-dash-muted" aria-label={generated('receiptTitle')}>
        {(['recommendations','progress','competitors'] as const).filter(section=>features[section==='recommendations'?'agent_recs':section==='progress'?'agent_progress':'agent_competitors']).map(section=><li key={section}>
          <span className="font-medium text-dash-text">{t(section==='recommendations'?'recs_title':section==='progress'?'progress_title':'competitors_title')}: </span>
          {generated(receipt.outcomes[section]==='available'?'sectionAvailable':receipt.outcomes[section]==='not-required'?'sectionNotRequired':section==='recommendations'?'recommendationsUnavailable':section==='progress'?'progressUnavailable':'competitorsUnavailable')}
        </li>)}
      </ul>:null}
      {features.agent_recs&&basis.length>0?<section className="space-y-3 rounded-xl border border-dash-border bg-dash-surface p-5" aria-label={generated('basisTitle')}>
        <h3 className="text-sm font-semibold text-dash-text">{generated('basisTitle')}</h3>
        {basis.map(item=><article key={item.checkId} className="space-y-2 border-t border-dash-border pt-3 text-sm text-dash-muted">
          <p className="font-medium text-dash-text">{generated('basisCheck',{checkId:item.checkId,assessment:generated(item.assessment==='fail'?'basisFailed':'basisWarning')})}</p>
          <p>{item.action}</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {[...new Set(item.limitations.map(value=>limitationCopy[value]??'basisOtherLimitations'))].map(copy=><li key={copy}>{generated(copy)}</li>)}
          </ul>
          <a className="inline-flex min-h-11 items-center text-xs font-medium text-dash-accent underline" href={`?step=results&scanId=${encodeURIComponent(scan.id)}`}>{generated('viewSourceScan')}</a>
        </article>)}
      </section>:null}
      {features.agent_progress&&samples.length>0?<section className="space-y-2 rounded-xl border border-dash-border bg-dash-surface p-5" aria-label={generated('progressSampleTitle')}>
        <h3 className="text-sm font-semibold text-dash-text">{generated('progressSampleTitle')}</h3>
        <ul className="space-y-1 text-sm text-dash-muted">{samples.map(sample=><li key={`${sample.platform}:${sample.week}`}>
          {generated('progressSample',{platform:sample.platform,week:sample.week,ratio:`${sample.mentioned} / ${sample.classified}`})}
        </li>)}</ul>
        <p className="text-xs text-dash-muted">{generated('progressSampleNotice')}</p>
      </section>:null}
    <AgentSection status={status} hasOutput={Boolean(hasOutput)} draftNotice={generated('improveDraftNotice')}>
      <div className="space-y-3">
        {features.agent_recs ? (
          receipt?<section className="rounded-xl border border-dash-border bg-dash-surface p-5" aria-label={generated('websiteDraftsTitle')}>
            <h3 className="mb-3 text-sm font-semibold text-dash-text">{generated('websiteDraftsTitle')}</h3>
            {allowedRecs.length?<ul className="space-y-3 text-sm text-dash-text">{allowedRecs.map(rec=><li key={rec.id}>{rec.recommendation}</li>)}</ul>
              :<p className="text-sm text-dash-muted">{generated('recommendationsUnavailable')}</p>}
          </section>:<AgentRecommendations recommendations={allowedRecs} />
        ) : (
          <LockedFeature feature={t('feature_recs')} requiredPlan="Pro" price={proPrice} />
        )}

        {features.agent_progress ? (
          <AgentProgress progress={measuredProgress} />
        ) : (
          <LockedFeature feature={t('feature_progress')} requiredPlan="Pro" price={proPrice}>
            <AgentProgress progress={measuredProgress} />
          </LockedFeature>
        )}

        {features.agent_competitors ? (
          <AgentCompetitors competitors={measuredCompetitors} />
        ) : (
          <LockedFeature feature={t('feature_competitors')} requiredPlan="Enterprise" price={enterprisePrice}>
            <AgentCompetitors competitors={measuredCompetitors.slice(0, 1)} />
          </LockedFeature>
        )}
      </div>
    </AgentSection>
    </div>
  )
}
