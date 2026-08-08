'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Zap, X } from 'lucide-react'

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

const REGIONS = [
  { value: 'HK',     labelEn: 'Hong Kong',      labelZh: '香港' },
  { value: 'TW',     labelEn: 'Taiwan',         labelZh: '台灣' },
  { value: 'SG',     labelEn: 'Singapore',      labelZh: '新加坡' },
  { value: 'JP',     labelEn: 'Japan',          labelZh: '日本' },
  { value: 'KR',     labelEn: 'South Korea',    labelZh: '南韓' },
  { value: 'US',     labelEn: 'United States',  labelZh: '美國' },
  { value: 'UK',     labelEn: 'United Kingdom', labelZh: '英國' },
  { value: 'EU',     labelEn: 'European Union', labelZh: '歐盟' },
  { value: 'AU',     labelEn: 'Australia',      labelZh: '澳洲' },
  { value: 'CA',     labelEn: 'Canada',         labelZh: '加拿大' },
  { value: 'global', labelEn: 'Global',         labelZh: '全球' },
]

const COPY_EN = {
  stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
  s1Title: "What's your brand name?",
  s1Subtitle: 'This is how AI agents will look for you.',
  s1Placeholder: 'e.g. Fimmick',
  continue: 'Continue',
  back: 'Back',
  s2Title: 'Your website domain',
  s2Subtitle: 'Enter your domain — no need for www or http.',
  s2HintPrefix: 'e.g. type',
  s2HintNot: 'not',
  s2Skip: "Skip — I don't have a website yet",
  s3Title: 'Your industry & region',
  s3Subtitle: 'Personalises your AI authority score and Pulse benchmarks.',
  industryPlaceholder: 'Industry (optional)',
  regionPlaceholder: 'Region (optional)',
  s3Skip: 'Skip — set up later',
  s4Title: 'Tell AI what you do',
  s4Subtitle: 'A short description helps us generate better scan questions and improves your AI citation accuracy.',
  descLabel: 'Brand description',
  optional: '(optional)',
  descPlaceholder: (brand: string) => `e.g. ${brand || 'Your brand'} is an AI search optimisation platform that helps businesses improve their visibility in ChatGPT, Perplexity, and Google AI answers.`,
  competitorsLabel: 'Main competitors',
  competitorsHint: "AI may mention these brands instead of yours — we'll track that.",
  competitorsPlaceholder: 'e.g. Semrush, Ahrefs',
  add: 'Add',
  settingUp: 'Setting up…',
  goToDashboard: 'Go to my dashboard',
  s4Skip: "Skip — I'll set this up later",
  genericError: 'Something went wrong',
}

const COPY_ZH_HK: typeof COPY_EN = {
  stepOf: (step: number, total: number) => `第 ${step} 步，共 ${total} 步`,
  s1Title: '你的品牌名稱是？',
  s1Subtitle: 'AI 將以此名稱搜尋你的品牌。',
  s1Placeholder: '例如 Fimmick',
  continue: '繼續',
  back: '返回',
  s2Title: '你的網站域名',
  s2Subtitle: '輸入你的域名——無需 www 或 http。',
  s2HintPrefix: '例如輸入',
  s2HintNot: '而非',
  s2Skip: '略過——我暫時未有網站',
  s3Title: '你的行業及地區',
  s3Subtitle: '用於個人化你的 AI 權威分數及 Pulse 基準。',
  industryPlaceholder: '行業（可選）',
  regionPlaceholder: '地區（可選）',
  s3Skip: '略過——稍後設定',
  s4Title: '讓 AI 了解你的業務',
  s4Subtitle: '一段簡短描述有助我們生成更好的掃描問題，並提升你的 AI 引用準確度。',
  descLabel: '品牌描述',
  optional: '（可選）',
  descPlaceholder: (brand: string) => `例如：${brand || '你的品牌'} 是一個 AI 搜尋優化平台，幫助企業提升在 ChatGPT、Perplexity 及 Google AI 答案中的能見度。`,
  competitorsLabel: '主要競爭對手',
  competitorsHint: 'AI 可能會提及這些品牌而非你的品牌——我們會為你追蹤。',
  competitorsPlaceholder: '例如 Semrush, Ahrefs',
  add: '新增',
  settingUp: '設定中…',
  goToDashboard: '前往我的儀表板',
  s4Skip: '略過——我稍後再設定',
  genericError: '發生錯誤，請再試一次',
}

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
  initialBrand?: string
  initialDomain?: string
  initialIndustry?: string
  initialRegion?: string
  scanId?: string
}

export function OnboardingWizard({
  lang, initialBrand = '', initialDomain = '',
  initialIndustry = '', initialRegion = '', scanId,
}: Props) {
  const router = useRouter()
  const isZh = lang === 'zh-HK'
  const c = isZh ? COPY_ZH_HK : COPY_EN
  const hasScanPrefill = Boolean(scanId && initialBrand && initialDomain)
  const [step, setStep] = useState(hasScanPrefill ? 3 : 1)
  const previousStepRef = useRef(step)
  const brandInputRef = useRef<HTMLInputElement>(null)
  const domainInputRef = useRef<HTMLInputElement>(null)
  const industrySelectRef = useRef<HTMLSelectElement>(null)
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (previousStepRef.current === step) return
    previousStepRef.current = step
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const target = step === 1 ? brandInputRef.current
      : step === 2 ? domainInputRef.current
        : step === 3 ? industrySelectRef.current
          : descriptionInputRef.current
    target?.focus()
  }, [step])

  const [brand, setBrand]           = useState(initialBrand)
  const [domain, setDomain]         = useState(normaliseDomain(initialDomain))
  const [industry, setIndustry]     = useState(initialIndustry)
  const [region, setRegion]         = useState(initialRegion)
  const [description, setDescription] = useState('')
  const [competitors, setCompetitors] = useState<string[]>([])
  const [competitorInput, setCompetitorInput] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  function handleDomainChange(raw: string) {
    // Normalise on the fly as the user types
    setDomain(normaliseDomain(raw))
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

  async function complete() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName:   brand,
        domain:      domain || undefined,
        industry:    industry || undefined,
        region:      region || undefined,
        description: description || undefined,
        competitors: competitors.length ? competitors : undefined,
        scanId,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? c.genericError); setLoading(false); return }
    if (scanId) {
      router.push(`/${lang}/dashboard/${data.clientId}/result/${scanId}`)
      return
    }
    const scanUrl = domain
      ? `?step=scan&url=${encodeURIComponent(domain.startsWith('http') ? domain : `https://${domain}`)}`
      : '?step=scan'
    router.push(`/${lang}/dashboard/${data.clientId}${scanUrl}`)
  }

  const progress = (step / TOTAL_STEPS) * 100

  const inputClass = "w-full h-11 rounded-lg border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
  const btnPrimary = "flex-1 h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-40 flex items-center justify-center gap-2"
  const btnBack    = "flex-1 h-11 border border-input text-foreground font-semibold rounded-lg text-sm hover:bg-muted transition"

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border p-8 w-full max-w-md shadow-sm">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-7">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-black text-foreground text-sm">Fimmick <span className="text-primary">AISO</span></span>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>{c.stepOf(step, TOTAL_STEPS)}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* ── Step 1: Brand name ── */}
        {step === 1 && (
          <div>
            <label htmlFor="onboarding-brand" className="block text-xl font-black text-foreground mb-1">{c.s1Title}</label>
            <p className="text-sm text-muted-foreground mb-6">{c.s1Subtitle}</p>
            <input
              id="onboarding-brand"
              name="brandName"
              ref={brandInputRef}
              value={brand}
              onChange={e => setBrand(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && brand.trim() && setStep(2)}
              placeholder={c.s1Placeholder}
              className={`${inputClass} mb-6`}
            />
            <button onClick={() => setStep(2)} disabled={!brand.trim()} className={btnPrimary}>
              {c.continue} <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Domain ── */}
        {step === 2 && (
          <div>
            <label htmlFor="onboarding-domain" className="block text-xl font-black text-foreground mb-1">{c.s2Title}</label>
            <p className="text-sm text-muted-foreground mb-1">{c.s2Subtitle}</p>
            <p className="text-2xs text-muted-foreground/60 mb-5">{c.s2HintPrefix} <span className="font-mono bg-muted px-1 rounded">fimmick.com</span> {c.s2HintNot} <span className="font-mono bg-muted px-1 rounded">https://www.fimmick.com</span></p>
            <div className="relative mb-6">
              <input
                id="onboarding-domain"
                name="domain"
                ref={domainInputRef}
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
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className={btnBack}>{c.back}</button>
              <button onClick={() => setStep(3)} className={btnPrimary}>
                {c.continue} <ChevronRight className="size-4" />
              </button>
            </div>
            <button onClick={() => setStep(3)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              {c.s2Skip}
            </button>
          </div>
        )}

        {/* ── Step 3: Industry + Region ── */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">{c.s3Title}</h1>
            <p className="text-sm text-muted-foreground mb-6">{c.s3Subtitle}</p>
            <div className="space-y-3 mb-6">
              <div>
                <label htmlFor="onboarding-industry" className="block text-xs font-semibold text-foreground mb-1.5">{c.industryPlaceholder}</label>
                <select id="onboarding-industry" name="industry" ref={industrySelectRef} value={industry} onChange={e => setIndustry(e.target.value)}
                  className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                  <option value="">{c.industryPlaceholder}</option>
                  {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{isZh ? i.labelZh : i.labelEn}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="onboarding-region" className="block text-xs font-semibold text-foreground mb-1.5">{c.regionPlaceholder}</label>
                <select id="onboarding-region" name="region" value={region} onChange={e => setRegion(e.target.value)}
                  className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                  <option value="">{c.regionPlaceholder}</option>
                  {REGIONS.map(r => <option key={r.value} value={r.value}>{isZh ? r.labelZh : r.labelEn}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className={btnBack}>{c.back}</button>
              <button onClick={() => setStep(4)} className={btnPrimary}>
                {c.continue} <ChevronRight className="size-4" />
              </button>
            </div>
            <button onClick={() => setStep(4)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              {c.s3Skip}
            </button>
          </div>
        )}

        {/* ── Step 4: Brand details ── */}
        {step === 4 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">{c.s4Title}</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {c.s4Subtitle}
            </p>

            {/* Brand description */}
            <div className="mb-4">
              <label htmlFor="onboarding-description" className="block text-xs font-semibold text-foreground mb-1.5">
                {c.descLabel} <span className="text-muted-foreground font-normal">{c.optional}</span>
              </label>
              <textarea
                id="onboarding-description"
                name="description"
                ref={descriptionInputRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={c.descPlaceholder(brand)}
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-relaxed"
              />
            </div>

            {/* Competitors */}
            <div className="mb-6">
              <label htmlFor="onboarding-competitor" className="block text-xs font-semibold text-foreground mb-1.5">
                {c.competitorsLabel} <span className="text-muted-foreground font-normal">{c.optional}</span>
              </label>
              <p className="text-2xs text-muted-foreground mb-2">{c.competitorsHint}</p>
              <div className="flex gap-2 mb-2">
                <input
                  id="onboarding-competitor"
                  name="competitor"
                  value={competitorInput}
                  onChange={e => setCompetitorInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCompetitor() }
                  }}
                  placeholder={c.competitorsPlaceholder}
                  className="flex-1 h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={addCompetitor}
                  disabled={!competitorInput.trim()}
                  className="h-9 px-3 rounded-lg bg-secondary text-foreground text-xs font-semibold border border-input hover:bg-muted transition disabled:opacity-40"
                >
                  {c.add}
                </button>
              </div>
              {competitors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {competitors.map(c => (
                    <span key={c} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded-full font-medium">
                      {c}
                      <button type="button" onClick={() => removeCompetitor(c)} className="hover:text-destructive transition">
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-destructive text-sm mb-4">{error}</p>}

            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className={btnBack}>{c.back}</button>
              <button onClick={complete} disabled={loading} className={`${btnPrimary} disabled:opacity-60`}>
                {loading ? c.settingUp : c.goToDashboard}
                {!loading && <ChevronRight className="size-4" />}
              </button>
            </div>
            <button onClick={complete} disabled={loading} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              {c.s4Skip}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
