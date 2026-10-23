'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Zap, X } from 'lucide-react'
import {trackFunnelEvent,consumeOneTimeFunnelEvent} from '@/lib/funnel-client'
import {loadBrowserDraft,saveBrowserDraft,removeBrowserDraft} from '@/lib/onboarding/browser-draft'
import { BrandAssistant } from './BrandAssistant'
import { UpgradeCard } from '@/components/dashboard/UpgradeCard'
import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { PROMPT_MARKETS, isPromptLanguage, type PromptLanguage } from '@/lib/prompts/context'
import { Wordmark } from '@/components/brand/Wordmark'

const INDUSTRIES = [
  { value: 'technology',         labelEn: 'Technology',            labelZh: '科技' },
  { value: 'finance',            labelEn: 'Finance & Banking',     labelZh: '金融及銀行' },
  { value: 'medical',            labelEn: 'Healthcare & Medical',  labelZh: '醫療保健' },
  { value: 'legal',              labelEn: 'Legal & Compliance',    labelZh: '法律及合規' },
  { value: 'retail_ecommerce',   labelEn: 'Retail & E-Commerce',   labelZh: '零售及電商' },
  { value: 'education',          labelEn: 'Education',             labelZh: '教育' },
  { value: 'real_estate',        labelEn: 'Real Estate',           labelZh: '地產' },
  { value: 'travel_hospitality', labelEn: 'Travel & Hospitality',  labelZh: '旅遊及酒店' },
  { value: 'media_entertainment',labelEn: 'Media & Entertainment', labelZh: '媒體及娛樂' },
  { value: 'manufacturing',      labelEn: 'Manufacturing',         labelZh: '製造業' },
  { value: 'energy_utilities',   labelEn: 'Energy & Utilities',    labelZh: '能源及公用事業' },
  { value: 'general_b2b',        labelEn: 'General B2B',           labelZh: '一般 B2B' },
  { value: 'general_b2c',        labelEn: 'General B2C',           labelZh: '一般 B2C' },
]

const REGIONS = PROMPT_MARKETS

/** Strip protocol and www prefix so only bare domain is stored */
function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')   // strip http:// or https://
    .replace(/^www\./i, '')          // strip www.
    .replace(/\/.*$/, '')            // strip any path after the domain
    .toLowerCase()
}

const TOTAL_STEPS = 4

interface Props {
  lang: string
  accountId?: string
  initialBrand?: string
  initialDomain?: string
  initialIndustry?: string
  initialRegion?: string
  scanId?: string
}

type Draft = { intentKey?: string; brand?: string; domain?: string; websiteUrl?: string; industry?: string; region?: string; language?: PromptLanguage; description?: string; competitors?: string[]; step?: number; clientId?: string; partial?: boolean; recoveredReady?: boolean; submittedPayload?: string }
const subscribeHydration = () => () => {}
export function OnboardingWizard(props: Props) {
  const ready = useSyncExternalStore(subscribeHydration, () => true, () => false)
  const draftKey = `aiso:onboarding:${props.accountId ?? 'fixture'}:${props.scanId ?? 'new'}`
  const draft = useMemo((): Draft => {
    if (!ready) return {}
    try {
      const raw = loadBrowserDraft(draftKey)
      if (!raw || raw.length > 20000) return {}
      const saved = JSON.parse(raw)
      if (!saved || typeof saved.intentKey !== 'string') return {}
      const clean: Draft = { intentKey: saved.intentKey, submittedPayload: typeof saved.submittedPayload==='string'?saved.submittedPayload:undefined }
      for (const key of ['brand','domain','websiteUrl','industry','region','description','clientId'] as const) {
        if (typeof saved[key] === 'string') clean[key] = saved[key]
      }
      if (Array.isArray(saved.competitors) && saved.competitors.every((v: unknown) => typeof v === 'string')) clean.competitors = saved.competitors
      if (Number.isInteger(saved.step) && saved.step >= 1 && saved.step <= TOTAL_STEPS) clean.step = saved.step
      clean.partial = saved.partial === true
      clean.recoveredReady = saved.recoveredReady === true
      if (isPromptLanguage(saved.language)) clean.language = saved.language
      return clean
    } catch { return {} }
  }, [ready, draftKey])
  return <WizardForm key={`${draftKey}:${ready}`} {...props} draft={draft} draftReady={ready} />
}

function WizardForm({
  lang, accountId = 'fixture', initialBrand = '', initialDomain = '',
  initialIndustry = '', initialRegion = '', scanId, draft, draftReady,
}: Props & { draft: Draft; draftReady: boolean }) {
  const router = useRouter()
  const isZh = lang === 'zh-HK'
  // Reads the lang prop rather than the provider, like the rest of this surface's copy.
  const t = isZh
    ? createTranslator({ locale: 'zh-HK', messages: zh, namespace: 'onboardingWizard' })
    : createTranslator({ locale: 'en', messages: en, namespace: 'onboardingWizard' })
  const shared = isZh ? zh : en
  const recoveryCopy = shared.onboardingSetup
  const started=useRef(false)
  useEffect(()=>{if(draftReady&&consumeOneTimeFunnelEvent(started))trackFunnelEvent({name:'onboarding_started',locale:lang==='zh-HK'?'zh-HK':'en'})},[draftReady,lang])
  const hasScanPrefill = Boolean(scanId && initialBrand && initialDomain)
  const [step, setStep] = useState(draft.step ?? (hasScanPrefill ? 3 : 1))
  const previousStepRef = useRef(step)
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (previousStepRef.current === step) return
    previousStepRef.current = step
    // Announce the new step without opening the mobile keyboard. The next Tab
    // reaches its first field at every viewport width.
    stepHeadingRef.current?.focus()
  }, [step])

  const [brand, setBrand]           = useState(draft.brand ?? initialBrand)
  const [domain, setDomain]         = useState(draft.domain ?? normaliseDomain(initialDomain))
  const [websiteUrl, setWebsiteUrl] = useState(draft.websiteUrl ?? draft.domain ?? initialDomain)
  const manualBrandRef = useRef<HTMLInputElement>(null)
  const [industry, setIndustry]     = useState(draft.industry ?? initialIndustry)
  const [region, setRegion]         = useState(draft.region ?? initialRegion)
  const [language, setLanguage] = useState<PromptLanguage|''>(draft.language ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [competitors, setCompetitors] = useState<string[]>(draft.competitors ?? [])
  const [competitorInput, setCompetitorInput] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [intentKey, setIntentKey] = useState(() => draft.intentKey ?? (draftReady ? crypto.randomUUID() : ''))
  const [clientId, setClientId] = useState<string | null>(draft.clientId ?? null)
  const [partial, setPartial] = useState(draft.partial ?? false)
  const [brandLimit, setBrandLimit] = useState(false)
  const [recoveredReady, setRecoveredReady] = useState(draft.recoveredReady ?? false)
  const submitted = useRef(false),submittedPayload=useRef(draft.submittedPayload)
  const draftKey = `aiso:onboarding:${accountId}:${scanId ?? 'new'}`
  useEffect(() => {
    if (!draftReady || submitted.current) return
    try { saveBrowserDraft(draftKey, JSON.stringify({ intentKey, brand, domain, websiteUrl, industry, region, language, description, competitors, step, clientId, partial,recoveredReady,submittedPayload:submittedPayload.current })) }
    catch { /* Form state still survives in this tab when storage is unavailable. */ }
  }, [draftReady, draftKey, intentKey, brand, domain, websiteUrl, industry, region, language, description, competitors, step, clientId, partial, recoveredReady])

  function handleDomainChange(raw: string) {
    // Normalise on the fly as the user types
    setDomain(normaliseDomain(raw))
    setWebsiteUrl(raw)
  }

  function addCompetitor() {
    const val = competitorInput.trim()
    if (val && !competitors.includes(val)) {
      setCompetitors(prev => [...prev, val])
    }
    setCompetitorInput('')
  }

  function removeCompetitor(c: string) {
    setCompetitors(prev => prev.filter(x => x !== c))
  }

  const inFlight=useRef(false)
  async function complete() {
    if(inFlight.current||recoveredReady)return
    inFlight.current=true
    setLoading(true)
    setError('')
    try {
      const values={brand,domain,industry,region,language,description,competitors,scanId}
      const payload=JSON.stringify(values)
      const send=(v:typeof values,key:string,target:string|null)=>fetch('/api/onboarding/complete',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brandName:v.brand,domain:v.domain||undefined,industry:v.industry||undefined,region:v.region||undefined,language:v.language||undefined,market:v.region||null,description:v.description||undefined,competitors:v.competitors.length?v.competitors:undefined,scanId:v.scanId,intentKey:key||undefined,clientId:target||undefined})
      })
      let targetClientId=clientId
      const previous=submittedPayload.current
      // Resolve the original immutable request before changing an unknown-outcome intent.
      if(!targetClientId&&previous!==undefined&&previous!==payload){
        const recovered=await send(JSON.parse(previous) as typeof values,intentKey,null)
        const body=await recovered.json()
        if(!recovered.ok){setError(typeof body.error==='string'?body.error:t('genericError'));return}
        if(typeof body.clientId!=='string'||!body.progress)throw new Error('Invalid progress')
        targetClientId=body.clientId;setClientId(body.clientId)
        if(body.progress.prompts==='ready'){
          // Original setup committed. Preserve the edited draft without rewriting it.
          setPartial(false);setRecoveredReady(true)
          try{saveBrowserDraft(draftKey,JSON.stringify({intentKey,...values,websiteUrl,step,clientId:body.clientId,partial:false,recoveredReady:true,submittedPayload:previous}))}catch{}
          return
        }
      }
      const requestIntent=targetClientId&&previous!==undefined&&previous!==payload?crypto.randomUUID():intentKey
      if(!saveBrowserDraft(draftKey,JSON.stringify({intentKey:requestIntent,...values,websiteUrl,step,clientId:targetClientId,partial,submittedPayload:payload}))){setError(recoveryCopy.cacheUnavailable);return}
      submittedPayload.current=payload;setIntentKey(requestIntent)
      const res=await send(values,requestIntent,targetClientId)
      const data = await res.json()
      if (res.status === 403 && data.error === 'BRAND_LIMIT_REACHED') { setBrandLimit(true); return }
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : t('genericError')); return }
      if (typeof data.clientId !== 'string' || !data.progress) throw new Error('Invalid progress')
      setClientId(data.clientId)
      // Keep the request intent: recovery may reuse the original progress row's identity.
      if (data.progress.prompts !== 'ready') { setPartial(true); setError(t('seedPartial')); return }
      submitted.current = true
      trackFunnelEvent({ name: 'onboarding_completed', locale: lang === 'zh-HK' ? 'zh-HK' : 'en' })
      try { removeBrowserDraft(draftKey) } catch { /* optional storage */ }
      navigateToWorkspace(data.clientId)
    } catch { setError(t('genericError')) }
    finally { inFlight.current=false;setLoading(false) }
  }

  function navigateToWorkspace(targetClientId: string) {
    if (scanId) { router.push(`/${lang}/dashboard/${targetClientId}/result/${scanId}`); return }
    const scanUrl = '/prompts'
    router.push(`/${lang}/dashboard/${targetClientId}${scanUrl}`)
  }

  const progress = (step / TOTAL_STEPS) * 100

  const inputClass = "w-full h-11 rounded-lg border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
  const btnPrimary = "min-w-0 flex-1 basis-28 min-h-11 px-2 py-2 [overflow-wrap:anywhere] bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-40 flex items-center justify-center gap-2"
  const btnBack    = "flex-1 basis-28 min-h-11 border border-border text-foreground font-semibold rounded-lg text-sm hover:bg-muted transition"

  return (
    <>
      <a href="#main-content" className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{shared.nav.skip_to_main}</a>
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border p-4 sm:p-8 w-full max-w-md shadow-sm">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-7">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <Wordmark className="font-black text-foreground text-sm" />
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>{t('stepOf', { step, total: TOTAL_STEPS })}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* ── Step 1: Brand name ── */}
        {step === 1 && (
          <div>
            <h1 ref={stepHeadingRef} tabIndex={-1} className="text-xl font-black text-foreground mb-4 focus-visible:outline-2 focus-visible:outline-primary">{t('setupTitle')}</h1>
            <BrandAssistant lang={lang} context={{ url: websiteUrl, language, market: region }} onContextChange={next => {
              setWebsiteUrl(next.url); setDomain(normaliseDomain(next.url)); setLanguage(next.language); setRegion(next.market)
            }} onManual={() => manualBrandRef.current?.focus()} onApply={suggestion => {
              setBrand(suggestion.brandName); setDomain(suggestion.domain); setWebsiteUrl(suggestion.domain); setDescription(suggestion.description)
              setIndustry(suggestion.industry ?? ''); setLanguage(suggestion.language); setRegion(suggestion.market); setStep(4)
            }} />
            <h2 className="text-lg font-bold text-foreground mb-1"><label htmlFor="onboarding-brand">{t('s1Title')}</label></h2>
            <p className="text-sm text-muted-foreground mb-6">{t('s1Subtitle')}</p>
            <input
              id="onboarding-brand"
              ref={manualBrandRef}
              name="brandName"
              value={brand}
              maxLength={160}
              onChange={e => setBrand(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && brand.trim() && setStep(2)}
              placeholder={t('s1Placeholder')}
              className={`${inputClass} mb-6`}
            />
            <button onClick={() => setStep(2)} disabled={!brand.trim()} className={btnPrimary}>
              {t('continue')} <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Domain ── */}
        {step === 2 && (
          <div>
            <h1 ref={stepHeadingRef} tabIndex={-1} className="text-xl font-black text-foreground mb-1 focus-visible:outline-2 focus-visible:outline-primary"><label htmlFor="onboarding-domain">{t('s2Title')}</label></h1>
            <p className="text-sm text-muted-foreground mb-1">{t('s2Subtitle')}</p>
            <p className="text-2xs text-muted-foreground/60 mb-5">{t.rich('s2Hint', { domain: chunks => <span className="font-mono bg-muted px-1 rounded">{chunks}</span> })}</p>
            <div className="relative mb-6">
              <input
                id="onboarding-domain"
                name="domain"
                value={domain}
                onChange={e => handleDomainChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setStep(3)}
                placeholder="fimmick.com"
                className={inputClass}
              />
              {domain && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-2xs text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">
                  ✓ {domain}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setStep(1)} className={btnBack}>{t('back')}</button>
              <button onClick={() => setStep(3)} className={btnPrimary}>
                {t('continue')} <ChevronRight className="size-4" />
              </button>
            </div>
            <button onClick={() => setStep(3)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              {t('s2Skip')}
            </button>
          </div>
        )}

        {/* ── Step 3: Industry + Region ── */}
        {step === 3 && (
          <div>
            <h1 ref={stepHeadingRef} tabIndex={-1} className="text-xl font-black text-foreground mb-1 focus-visible:outline-2 focus-visible:outline-primary">{t('s3Title')}</h1>
            <p className="text-sm text-muted-foreground mb-6">{t('s3Subtitle')}</p>
            <div className="space-y-3 mb-6">
              <div>
                <label htmlFor="onboarding-language" className="block text-xs font-semibold text-foreground mb-1.5">{shared.brandAssistant.language}</label>
                <select id="onboarding-language" name="language" value={language} onChange={e => { if (e.target.value === '' || isPromptLanguage(e.target.value)) setLanguage(e.target.value) }} className={inputClass}>
                  <option value="">{shared.brandAssistant.language}</option><option value="en">English</option><option value="zh-HK">繁體中文（香港）</option>
                </select>
              </div>
              <div>
                <label htmlFor="onboarding-industry" className="block text-xs font-semibold text-foreground mb-1.5">{t('industryPlaceholder')}</label>
                <select id="onboarding-industry" name="industry" value={industry} onChange={e => setIndustry(e.target.value)}
                  className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                  <option value="">{t('industryPlaceholder')}</option>
                  {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{isZh ? i.labelZh : i.labelEn}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="onboarding-region" className="block text-xs font-semibold text-foreground mb-1.5">{t('regionPlaceholder')}</label>
                <select id="onboarding-region" name="region" value={region} onChange={e => setRegion(e.target.value)}
                  className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                  <option value="">{t('regionPlaceholder')}</option>
                  {REGIONS.map(r => <option key={r.value} value={r.value}>{isZh ? r.labelZh : r.labelEn}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setStep(2)} className={btnBack}>{t('back')}</button>
              <button onClick={() => setStep(4)} className={btnPrimary}>
                {t('continue')} <ChevronRight className="size-4" />
              </button>
            </div>
            <button onClick={() => setStep(4)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              {t('s3Skip')}
            </button>
          </div>
        )}

        {/* ── Step 4: Brand details ── */}
        {step === 4 && (
          <div>
            <h1 ref={stepHeadingRef} tabIndex={-1} className="text-xl font-black text-foreground mb-1 focus-visible:outline-2 focus-visible:outline-primary">{t('s4Title')}</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {t('s4Subtitle')}
            </p>

            <section aria-label={recoveryCopy.summaryTitle} className="mb-4 rounded-lg border p-3 text-sm">
              <h2 className="font-semibold mb-2">{recoveryCopy.summaryTitle}</h2>
              <p>{brand} · {domain || recoveryCopy.websiteMissing}</p>
              <p>{language || recoveryCopy.contextMissing} · {region || recoveryCopy.contextMissing}</p>
              <p className="mt-2">{language && region ? recoveryCopy.questionSummary : recoveryCopy.contextPending}</p>
              <p>{recoveryCopy.monitoringSeparate}</p>
            </section>
            {/* Brand description */}
            <p className="mb-2 font-semibold">{brand} · {domain}</p>
            <p className="mb-4 text-sm text-muted-foreground">{shared.brandAssistant.language}: {language === 'en' ? 'English' : language === 'zh-HK' ? '繁體中文（香港）' : '—'} · {REGIONS.find(r => r.value === region)?.[isZh ? 'labelZh' : 'labelEn'] ?? t('regionPlaceholder')}</p>
            <div className="mb-4">
              <label htmlFor="onboarding-description" className="block text-xs font-semibold text-foreground mb-1.5">
                {t('descLabel')} <span className="text-muted-foreground font-normal">{t('optional')}</span>
              </label>
              <textarea
                id="onboarding-description"
                name="description"
                maxLength={4000}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('descPlaceholder', { brand: brand || t('yourBrand') })}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-relaxed"
              />
            </div>

            {/* Competitors */}
            <div className="mb-6">
              <label htmlFor="onboarding-competitor" className="block text-xs font-semibold text-foreground mb-1.5">
                {t('competitorsLabel')} <span className="text-muted-foreground font-normal">{t('optional')}</span>
              </label>
              <p className="text-2xs text-muted-foreground mb-2">{t('competitorsHint')}</p>
              <div className="flex gap-2 mb-2">
                <input
                  id="onboarding-competitor"
                  name="competitor"
                  value={competitorInput}
                  onChange={e => setCompetitorInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCompetitor() }
                  }}
                  placeholder={t('competitorsPlaceholder')}
                  className="min-w-0 flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={addCompetitor}
                  disabled={!competitorInput.trim()}
                  className="h-9 px-3 rounded-lg bg-secondary text-foreground text-xs font-semibold border border-border hover:bg-muted transition disabled:opacity-40"
                >
                  {t('add')}
                </button>
              </div>
              {competitors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {competitors.map(competitor => (
                    <span key={competitor} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded-full font-medium">
                      {competitor}
                      <button type="button" onClick={() => removeCompetitor(competitor)} aria-label={t('removeCompetitor', { name: competitor })} className="min-h-6 min-w-6 inline-flex items-center justify-center hover:text-destructive transition">
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {recoveredReady && <p role="status" className="text-sm mb-4">{recoveryCopy.reconciledReady}</p>}
            {brandLimit && <div className="mb-4"><UpgradeCard title={(lang === 'zh-HK' ? zh : en).dashboard.upgrade.brandLimitTitle} body={(lang === 'zh-HK' ? zh : en).dashboard.upgrade.brandLimitShort} cta={(lang === 'zh-HK' ? zh : en).dashboard.upgrade.cta} href={`/${lang}/pricing`} /></div>}
            {error && <p role="alert" className="text-destructive text-sm mb-4">{error}</p>}
            {error===recoveryCopy.cacheUnavailable&&<a href={`/${lang}/dashboard`} className={btnBack}>{recoveryCopy.reviewBrands}</a>}

            <div className="flex flex-wrap gap-3">
              <button onClick={() => setStep(3)} className={btnBack}>{t('back')}</button>
              <button onClick={complete} disabled={loading || recoveredReady} className={`${btnPrimary} disabled:opacity-60`}>
                {loading ? t('settingUp') : partial ? t('retrySeed') : t('goToDashboard')}
                {!loading && <ChevronRight className="size-4" />}
              </button>
            </div>
            {(partial || recoveredReady) && clientId && <button type="button" onClick={() => navigateToWorkspace(clientId)} className={`${btnBack} mt-3 w-full`}>{t('openWorkspace')}</button>}
            <button onClick={complete} disabled={loading || recoveredReady} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              {t('s4Skip')}
            </button>
          </div>
        )}

      </div>
      </main>
    </>
  )
}
