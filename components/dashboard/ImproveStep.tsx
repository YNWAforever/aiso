'use client'
import {useEffect,useRef,useState} from 'react'
import { useTranslations } from 'next-intl'
import {useParams,useRouter} from 'next/navigation'
import { AgentSection } from '@/components/dashboard/AgentSection'
import { AgentRecommendations } from '@/components/dashboard/AgentRecommendations'
import { AgentProgress } from '@/components/dashboard/AgentProgress'
import { AgentCompetitors } from '@/components/dashboard/AgentCompetitors'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { ScanPicker } from '@/components/dashboard/ScanPicker'
import { PLAN_CATALOG } from '@/lib/plans/catalog'
import type { ScanChoice } from '@/lib/workspace/scan-choices'
import type { Scan, AgentRecommendation, AgentProgress as AgentProgressType, AgentCompetitor } from '@/lib/types'
import {readAgentGeneration,type AgentGenerationReceipt} from '@/lib/agents/generation-state'
import {normalizeAgentNumbers} from '@/lib/workspace/agent-numbers'
import {runtimePlatformsFor} from '@/lib/pulse/platforms'

type Props = {
  scan: Scan
  smeCopilot?: boolean
  features: import('@/lib/types').PlanFeatures
  recommendations: AgentRecommendation[]
  progress: AgentProgressType[]
  competitors: AgentCompetitor[]
  scanChoices?: ScanChoice[]
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

export function ImproveStep({ scan, features, recommendations, progress, competitors, scanChoices, smeCopilot = false }: Props) {
  const t = useTranslations('dashboard')
  const generated=useTranslations('generatedWork')
  const checks=useTranslations('checks')
  const {clientId,lang}=useParams<{clientId:string;lang:string}>()
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
  // Keep "more analyses" out of the page when every available source is empty;
  // the status strip already says those sources are unavailable.
  const moreVisible = !features.agent_progress || !features.agent_competitors || measuredProgress.length > 0 || measuredCompetitors.length > 0
  const statusSections = (['recommendations','progress','competitors'] as const)
    .filter(section => features[section==='recommendations'?'agent_recs':section==='progress'?'agent_progress':'agent_competitors'])

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

  const scanDate = new Date(scan.created_at).toLocaleString(lang, {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const scanScore = scan.score != null ? `${scan.score}${scan.grade ? ` (${scan.grade})` : ''}` : '—'

  return (
    <div className="space-y-4">
      {(smeCopilot || features.agent_recs) && typeof clientId === 'string' ? (
        <section aria-labelledby="improve-action-heading" aria-busy={loading} className="rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-e2 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-accessible">{generated('actionTitle')}</p>
              <h2 id="improve-action-heading" className="mt-2 text-sm font-semibold text-muted-foreground">{generated('selectedScan')}</h2>
              <p className="mt-1 break-all text-lg font-bold text-foreground">{scan.domain}</p>
              <p className="mt-1 text-sm text-muted-foreground">{scanDate} · {scanScore}</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:flex-col">
              {smeCopilot ? (
                <a className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground text-center focus-visible:outline-2 focus-visible:outline-offset-2" href={`/${lang === 'zh-HK' ? 'zh-HK' : 'en'}/dashboard/${encodeURIComponent(clientId)}/opportunities`}>{generated('reviewDraftEvidence')}</a>
              ) : null}
              {features.agent_recs ? (
                <button type="button" onClick={generate} disabled={loading} className={smeCopilot ? 'min-h-11 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60' : 'min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60'}>
                  {loading?generated(attempt?.checking?'checkingStatus':'generating'):status==='complete'?generated('refreshStatus'):checkStatus?generated('checkStatus'):status==='error'?generated('retry'):generated('generateImprove')}
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{smeCopilot ? generated('draftEvidenceNotice') : generated('improveActionNotice')}</p>
          {scanChoices && scanChoices.length > 0 && typeof clientId === 'string' ? (
            <div className="mt-4 border-t border-primary/20 pt-4">
              <ScanPicker
                lang={lang}
                action={`/${lang}/dashboard/${encodeURIComponent(clientId)}`}
                step="improve"
                scans={scanChoices}
                selectedScanId={scan.id}
                className="mb-0"
              />
            </div>
          ) : null}
        </section>
      ) : null}
      {!(smeCopilot || features.agent_recs) && scanChoices && scanChoices.length > 0 && typeof clientId === 'string' ? (
        <section aria-label={generated('selectedScan')} className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <ScanPicker
            lang={lang}
            action={`/${lang}/dashboard/${encodeURIComponent(clientId)}`}
            step="improve"
            scans={scanChoices}
            selectedScanId={scan.id}
            className="mb-0"
          />
        </section>
      ) : null}
      {receipt && statusSections.length > 0 ? (
        <section aria-labelledby="improve-status-heading" className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 id="improve-status-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{generated('statusTitle')}</h2>
          <ul className={`mt-3 grid gap-2 ${statusSections.length === 2 ? 'sm:grid-cols-2' : statusSections.length >= 3 ? 'sm:grid-cols-3' : ''}`}>
            {statusSections.map(section => {
                const outcome = receipt.outcomes[section]
                const label = section==='recommendations' ? t('recs_title') : section==='progress' ? t('progress_title') : t('competitors_title')
                const text = outcome==='available' ? generated('sectionAvailable')
                  : outcome==='not-required' ? generated('sectionNotRequired')
                  : generated(section==='recommendations'?'recommendationsUnavailable':section==='progress'?'progressUnavailable':'competitorsUnavailable')
                return <li key={section} className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
                  <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${outcome==='available'?'bg-tone-success':'bg-muted-foreground/50'}`} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-foreground">{label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{text}</span>
                  </span>
                </li>
              })}
          </ul>
        </section>
      ) : null}

      <AgentSection status={status} hasOutput={Boolean(hasOutput)} draftNotice={generated('improveDraftNotice')}>
        <div className="space-y-6">
          {features.agent_recs ? (
            <section aria-labelledby="improve-drafts-heading" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="improve-drafts-heading" className="text-base font-semibold text-foreground">{generated('websiteDraftsTitle')}</h3>
                <span className="text-xs text-muted-foreground">{generated('draftCount',{count:allowedRecs.length})}</span>
              </div>
              {allowedRecs.length
                ? <div className="mt-4"><AgentRecommendations recommendations={allowedRecs} /></div>
                : <p role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">{receipt?generated('recommendationsUnavailable'):t('recs_empty')}</p>}
            </section>
          ) : (
            <LockedFeature feature={t('feature_recs')} requiredPlan="Pro" price={proPrice} />
          )}

          {basis.length > 0 ? (
            <section aria-labelledby="improve-evidence-heading" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="improve-evidence-heading" className="text-base font-semibold text-foreground">{generated('basisTitle')}</h3>
                <span className="text-xs text-muted-foreground">{generated('evidenceCount',{count:basis.length})}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{generated('basisRetention')}</p>
              <div className="mt-3 divide-y divide-border border-t border-border">
                {basis.map(item => {
                  const assessment = generated(item.assessment==='fail'?'basisFailed':'basisWarning')
                  const badge = item.assessment==='fail' ? 'bg-tone-danger-soft text-tone-danger-fg' : 'bg-tone-warning-soft text-tone-warning-fg'
                  return (
                    <details key={item.checkId} className="group">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${item.assessment==='fail'?'bg-tone-danger':'bg-tone-warning'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground">{checks(item.checkId)}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{item.checkId}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>{assessment}</span>
                        <span aria-hidden="true" className="shrink-0 text-lg leading-none text-muted-foreground transition-transform group-open:rotate-90">›</span>
                      </summary>
                      <div className="space-y-3 pb-4 pl-5 pr-1">
                        <p className="break-words text-sm leading-relaxed text-foreground">{item.action}</p>
                        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                          {[...new Set(item.limitations.map(value=>limitationCopy[value]??'basisOtherLimitations'))].map(copy=><li key={copy}>{generated(copy)}</li>)}
                        </ul>
                        <a className="inline-flex min-h-11 items-center text-xs font-semibold text-primary-accessible underline" href={`?step=results&scanId=${encodeURIComponent(scan.id)}`}>{generated('viewSourceScan')}</a>
                      </div>
                    </details>
                  )
                })}
              </div>
            </section>
          ) : null}

          {features.agent_progress&&samples.length>0 ? (
            <section aria-labelledby="improve-samples-heading" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <h3 id="improve-samples-heading" className="text-base font-semibold text-foreground">{generated('progressSampleTitle')}</h3>
              <ul className="mt-3 space-y-1 text-sm text-foreground">{samples.map(sample=><li key={`${sample.platform}:${sample.week}`}>
                {generated('progressSample',{platform:sample.platform,week:sample.week,ratio:`${sample.mentioned} / ${sample.classified}`})}
              </li>)}</ul>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{generated('progressSampleNotice')}</p>
            </section>
          ) : null}

          {moreVisible ? (
            <section aria-labelledby="improve-more-heading" className="space-y-3">
              <h3 id="improve-more-heading" className="text-base font-semibold text-foreground">{generated('moreTitle')}</h3>
              {features.agent_progress ? (
                measuredProgress.length > 0 ? <AgentProgress progress={measuredProgress} /> : null
              ) : (
                <LockedFeature feature={t('feature_progress')} requiredPlan="Pro" price={proPrice} />
              )}
              {features.agent_competitors ? (
                measuredCompetitors.length > 0 ? <AgentCompetitors competitors={measuredCompetitors} /> : null
              ) : (
                <LockedFeature feature={t('feature_competitors')} requiredPlan="Enterprise" price={enterprisePrice} />
              )}
            </section>
          ) : null}
        </div>
      </AgentSection>
    </div>
  )
}
