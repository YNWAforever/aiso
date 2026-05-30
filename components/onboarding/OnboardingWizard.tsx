'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Zap } from 'lucide-react'

const INDUSTRIES = [
  { value: 'technology',        label: 'Technology' },
  { value: 'finance',           label: 'Finance & Banking' },
  { value: 'medical',           label: 'Healthcare & Medical' },
  { value: 'legal',             label: 'Legal & Compliance' },
  { value: 'retail_ecommerce',  label: 'Retail & E-Commerce' },
  { value: 'education',         label: 'Education' },
  { value: 'real_estate',       label: 'Real Estate' },
  { value: 'travel_hospitality', label: 'Travel & Hospitality' },
  { value: 'media_entertainment', label: 'Media & Entertainment' },
  { value: 'manufacturing',     label: 'Manufacturing' },
  { value: 'energy_utilities',  label: 'Energy & Utilities' },
  { value: 'general_b2b',       label: 'General B2B' },
  { value: 'general_b2c',       label: 'General B2C' },
]

const REGIONS = [
  { value: 'HK', label: 'Hong Kong' }, { value: 'TW', label: 'Taiwan' },
  { value: 'SG', label: 'Singapore' }, { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' }, { value: 'US', label: 'United States' },
  { value: 'UK', label: 'United Kingdom' }, { value: 'EU', label: 'European Union' },
  { value: 'AU', label: 'Australia' }, { value: 'CA', label: 'Canada' },
  { value: 'global', label: 'Global' },
]

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
  const [brand, setBrand] = useState(initialBrand)
  const [domain, setDomain] = useState(initialDomain)
  const [industry, setIndustry] = useState(initialIndustry)
  const [region, setRegion] = useState(initialRegion)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function complete() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: brand, domain, industry: industry || undefined, region: region || undefined, scanId }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Something went wrong'); setLoading(false); return }
    router.push(`/${lang}/dashboard/${data.clientId}`)
  }

  const progress = (step / 3) * 100

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border p-8 w-full max-w-md shadow-sm">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-black text-foreground text-sm">Fimmick <span className="text-primary">AISO</span></span>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Step {step} of 3</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Step 1: Brand */}
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
              className="w-full h-11 rounded-lg border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-6"
            />
            <button
              onClick={() => setStep(2)}
              disabled={!brand.trim()}
              className="w-full h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* Step 2: Domain */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Confirm your domain</h1>
            <p className="text-sm text-muted-foreground mb-6">We&apos;ll use this as your primary tracked domain.</p>
            <input
              autoFocus
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && domain.trim() && setStep(3)}
              placeholder="e.g. fimmick.com"
              className="w-full h-11 rounded-lg border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-6"
            />
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 h-11 border border-input text-foreground font-semibold rounded-lg text-sm hover:bg-muted transition">
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!domain.trim()}
                className="flex-1 h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Industry + Region */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Your industry &amp; region</h1>
            <p className="text-sm text-muted-foreground mb-6">Personalises your AI authority score and Pulse benchmarks.</p>
            <div className="space-y-3 mb-6">
              <select
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Industry (optional)</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
              <select
                value={region}
                onChange={e => setRegion(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Region (optional)</option>
                {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {error && <p className="text-destructive text-sm mb-4">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 h-11 border border-input text-foreground font-semibold rounded-lg text-sm hover:bg-muted transition">
                Back
              </button>
              <button
                onClick={complete}
                disabled={loading}
                className="flex-1 h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? 'Setting up…' : 'Go to my dashboard'}
                {!loading && <ChevronRight className="size-4" />}
              </button>
            </div>
            <button onClick={complete} disabled={loading} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              Skip &mdash; I&apos;ll set this up later
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
