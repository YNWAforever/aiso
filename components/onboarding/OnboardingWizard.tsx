'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Zap, X } from 'lucide-react'

const INDUSTRIES = [
  { value: 'technology',         label: 'Technology' },
  { value: 'finance',            label: 'Finance & Banking' },
  { value: 'medical',            label: 'Healthcare & Medical' },
  { value: 'legal',              label: 'Legal & Compliance' },
  { value: 'retail_ecommerce',   label: 'Retail & E-Commerce' },
  { value: 'education',          label: 'Education' },
  { value: 'real_estate',        label: 'Real Estate' },
  { value: 'travel_hospitality', label: 'Travel & Hospitality' },
  { value: 'media_entertainment',label: 'Media & Entertainment' },
  { value: 'manufacturing',      label: 'Manufacturing' },
  { value: 'energy_utilities',   label: 'Energy & Utilities' },
  { value: 'general_b2b',        label: 'General B2B' },
  { value: 'general_b2c',        label: 'General B2C' },
]

const REGIONS = [
  { value: 'HK',     label: 'Hong Kong' },
  { value: 'TW',     label: 'Taiwan' },
  { value: 'SG',     label: 'Singapore' },
  { value: 'JP',     label: 'Japan' },
  { value: 'KR',     label: 'South Korea' },
  { value: 'US',     label: 'United States' },
  { value: 'UK',     label: 'United Kingdom' },
  { value: 'EU',     label: 'European Union' },
  { value: 'AU',     label: 'Australia' },
  { value: 'CA',     label: 'Canada' },
  { value: 'global', label: 'Global' },
]

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
  const [step, setStep] = useState(1)

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
    if (!res.ok) { setError(data.error ?? 'Something went wrong'); setLoading(false); return }
    // Go straight to the scan step with the brand domain pre-filled
    // This triggers an immediate scan (which fires n8n) rather than leaving the user in an empty dashboard
    const scanUrl = domain ? `?step=scan&url=${encodeURIComponent(domain.startsWith('http') ? domain : `https://${domain}`)}` : '?step=scan'
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
            <span>Step {step} of {TOTAL_STEPS}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* ── Step 1: Brand name ── */}
        {step === 1 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">What&apos;s your brand name?</h1>
            <p className="text-sm text-muted-foreground mb-6">This is how AI agents will look for you.</p>
            <input
              autoFocus
              value={brand}
              onChange={e => setBrand(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && brand.trim() && setStep(2)}
              placeholder="e.g. Fimmick"
              className={`${inputClass} mb-6`}
            />
            <button onClick={() => setStep(2)} disabled={!brand.trim()} className={btnPrimary}>
              Continue <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Domain ── */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Your website domain</h1>
            <p className="text-sm text-muted-foreground mb-1">Enter your domain — no need for www or http.</p>
            <p className="text-2xs text-muted-foreground/60 mb-5">e.g. type <span className="font-mono bg-muted px-1 rounded">fimmick.com</span> not <span className="font-mono bg-muted px-1 rounded">https://www.fimmick.com</span></p>
            <div className="relative mb-6">
              <input
                autoFocus
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
              <button onClick={() => setStep(1)} className={btnBack}>Back</button>
              <button onClick={() => setStep(3)} className={btnPrimary}>
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
            <button onClick={() => setStep(3)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              Skip — I don&apos;t have a website yet
            </button>
          </div>
        )}

        {/* ── Step 3: Industry + Region ── */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Your industry &amp; region</h1>
            <p className="text-sm text-muted-foreground mb-6">Personalises your AI authority score and Pulse benchmarks.</p>
            <div className="space-y-3 mb-6">
              <select value={industry} onChange={e => setIndustry(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="">Industry (optional)</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
              <select value={region} onChange={e => setRegion(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="">Region (optional)</option>
                {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className={btnBack}>Back</button>
              <button onClick={() => setStep(4)} className={btnPrimary}>
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
            <button onClick={() => setStep(4)} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              Skip — set up later
            </button>
          </div>
        )}

        {/* ── Step 4: Brand details ── */}
        {step === 4 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Tell AI what you do</h1>
            <p className="text-sm text-muted-foreground mb-6">
              A short description helps us generate better scan questions and improves your AI citation accuracy.
            </p>

            {/* Brand description */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Brand description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={`e.g. ${brand || 'Your brand'} is an AI search optimisation platform that helps businesses improve their visibility in ChatGPT, Perplexity, and Google AI answers.`}
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none leading-relaxed"
              />
            </div>

            {/* Competitors */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Main competitors <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <p className="text-2xs text-muted-foreground mb-2">AI may mention these brands instead of yours — we&apos;ll track that.</p>
              <div className="flex gap-2 mb-2">
                <input
                  value={competitorInput}
                  onChange={e => setCompetitorInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCompetitor() }
                  }}
                  placeholder="e.g. Semrush, Ahrefs"
                  className="flex-1 h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={addCompetitor}
                  disabled={!competitorInput.trim()}
                  className="h-9 px-3 rounded-lg bg-secondary text-foreground text-xs font-semibold border border-input hover:bg-muted transition disabled:opacity-40"
                >
                  Add
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
              <button onClick={() => setStep(3)} className={btnBack}>Back</button>
              <button onClick={complete} disabled={loading} className={`${btnPrimary} disabled:opacity-60`}>
                {loading ? 'Setting up…' : 'Go to my dashboard'}
                {!loading && <ChevronRight className="size-4" />}
              </button>
            </div>
            <button onClick={complete} disabled={loading} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              Skip — I&apos;ll set this up later
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
