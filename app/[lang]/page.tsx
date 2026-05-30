'use client'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import {
  Zap, BarChart2, ShieldCheck, Globe, Brain, FileText,
  Layers, TrendingUp, Award, ChevronRight, Search, Star
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'

/* ── Static content ─────────────────────────────────────────── */

const AI_PLATFORMS = [
  { name: 'ChatGPT',    color: '#10a37f' },
  { name: 'Perplexity', color: '#6c6eed' },
  { name: 'Claude',     color: '#d97706' },
  { name: 'Gemini',     color: '#4285f4' },
  { name: 'Google AIO', color: '#34a853' },
]

const STEPS = [
  {
    num: '01',
    title: 'Enter Your URL',
    body: 'Paste your website URL. Optionally select your industry and region for a personalised Authority score.',
  },
  {
    num: '02',
    title: 'Get Your AISO Grade',
    body: '20 checks run instantly. Receive a 100-point score and an A+→F grade across Core, Extended, and GEO checks.',
  },
  {
    num: '03',
    title: 'Fix & Track',
    body: 'Download your Fix Pack — Content Brief, Chunk Rewriter, and Cluster Map. Then track weekly with AI Pulse.',
  },
]

const FEATURES = [
  {
    icon: Layers,
    title: '5-Layer Authority Engine',
    body: 'TLD trust → Wikipedia & Tranco signals → Industry pack (13 sectors) → Regional pack (11 markets) → Dynamic learning from real AI citations.',
    accent: 'from-violet-500/20 to-purple-500/10',
    badge: 'Authority Engine',
  },
  {
    icon: Search,
    title: '20 AI Readiness Checks',
    body: 'Core technical (45 pts): robots.txt, llms.txt, bot access, schema, extractability. GEO content (25 pts): citation density, factual density, topical authority, chunkability.',
    accent: 'from-blue-500/20 to-cyan-500/10',
    badge: '100-Point Score',
  },
  {
    icon: Brain,
    title: 'Citation Density Analysis',
    body: 'Scans every external link on your page, scores each source through the Authority Engine, and shows you exactly which citations will earn AI trust.',
    accent: 'from-emerald-500/20 to-teal-500/10',
    badge: 'GEO Check #17',
  },
  {
    icon: FileText,
    title: 'GEO Content Fix Packs',
    body: 'Three automated outputs: a Content Brief for your next pillar page, a Chunk Rewriter to make existing content AI-citable, and a Topical Cluster Map.',
    accent: 'from-orange-500/20 to-amber-500/10',
    badge: 'Fix Pack #8–10',
  },
  {
    icon: BarChart2,
    title: 'AI Pulse Citation Loop',
    body: 'Weekly share-of-voice tracking across ChatGPT, Perplexity, Claude, Gemini, and Google AIO. Every citation feeds back into Layer 5 to refine your authority score.',
    accent: 'from-pink-500/20 to-rose-500/10',
    badge: 'Closed-Loop',
  },
  {
    icon: Globe,
    title: 'Industry × Region Intelligence',
    body: '13 industry packs × 11 regional packs means your authority score is calibrated to what AI actually trusts in your specific market — not a generic benchmark.',
    accent: 'from-sky-500/20 to-indigo-500/10',
    badge: '143 Combinations',
  },
]

const STATS = [
  { value: '20',  label: 'AI Readiness Checks' },
  { value: '5',   label: 'Authority Layers' },
  { value: '13',  label: 'Industry Packs' },
  { value: '11',  label: 'Regional Markets' },
  { value: '6',   label: 'AI Platforms Tracked' },
  { value: 'A+',  label: 'Highest Grade' },
]

const SCORE_BREAKDOWN = [
  { label: 'Core Checks',     pts: 45, color: 'bg-primary',         checks: 'c1–c5' },
  { label: 'Extended Checks', pts: 30, color: 'bg-violet-500',      checks: 'c6–c16' },
  { label: 'GEO Checks',      pts: 25, color: 'bg-emerald-500',     checks: 'c17–c20' },
]

/* ── Component ──────────────────────────────────────────────── */

export default function HomePage() {
  const t      = useTranslations()
  const router = useRouter()
  const params = useParams<{ lang: string }>()
  const [url, setUrl]               = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [industry, setIndustry]     = useState('')
  const [region, setRegion]         = useState('')
  const [showPersonalise, setShowPersonalise] = useState(false)
  const [scanStep, setScanStep]     = useState(0)

  const SCAN_STEPS = [
    'Checking robots.txt for AI crawlers…',
    'Reading llms.txt…',
    'Testing bot accessibility…',
    'Parsing structured data…',
    'Analysing content extractability…',
    'Running extended checks…',
    'Computing GEO citation density…',
    'Scoring factual density…',
    'Mapping topical authority…',
    'Measuring chunkability…',
    'Calculating your AISO grade…',
  ]

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setScanStep(0)

    // Cycle through step labels while waiting
    const interval = setInterval(() => {
      setScanStep(prev => (prev + 1 < SCAN_STEPS.length ? prev + 1 : prev))
    }, 1200)

    try {
      const res = await fetch('/api/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          url,
          industry: industry || undefined,
          region:   region   || undefined,
        }),
      })
      clearInterval(interval)
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      router.push(`/${params.lang}/result/${data.id}`)
    } catch {
      clearInterval(interval)
      setError(t('home.scan_error'))
      setLoading(false)
    }
  }

  const otherLang  = params.lang === 'en' ? 'zh-HK' : 'en'
  const otherLabel = params.lang === 'en' ? '中文' : 'EN'

  return (
    <div className="min-h-screen bg-background">

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="bg-card/80 backdrop-blur border-b px-6 py-3.5 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-black text-foreground text-sm tracking-tight">
            Fimmick <span className="text-primary">AISO</span>
          </span>
          <span className="hidden sm:inline text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full ml-1 tracking-wider">
            PLATFORM
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${params.lang}/auth/login`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
          >
            {t('nav.sign_in')}
          </Link>
          <Button size="sm" asChild>
            <Link href={`/${params.lang}/pricing`}>{t('nav.get_started')}</Link>
          </Button>
          <Link href={`/${otherLang}`} className="text-xs text-muted-foreground hover:text-primary transition-colors border rounded px-2 py-1">
            {otherLabel}
          </Link>
        </div>
      </nav>

      <main>

        {/* ── Hero ────────────────────────────────────────────── */}
        <section className="relative max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
          {/* Subtle radial gradient glow */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center -z-10">
            <div className="w-[600px] h-[400px] rounded-full bg-primary/5 blur-3xl" />
          </div>

          <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold tracking-widest px-4 py-1.5 rounded-full mb-6">
            <Zap className="size-3" />
            {t('home.badge')}
          </span>

          <h1 className="text-5xl sm:text-6xl font-black text-foreground leading-[1.05] mb-5 whitespace-pre-line">
            {t('home.headline')}
          </h1>
          <p className="text-muted-foreground text-lg sm:text-xl mb-3 max-w-xl mx-auto leading-relaxed">
            {t('home.subheadline')}
          </p>
          <p className="text-sm text-muted-foreground/70 mb-10">
            {t('home.trust')}
          </p>

          {/* Scan form */}
          <form onSubmit={handleScan} className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto">
            <Input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('home.placeholder')}
              className="flex-1 h-11 text-sm border-2 border-primary/40 focus-visible:border-primary focus-visible:ring-primary/20"
              required
              disabled={loading}
            />
            <Button type="submit" disabled={loading} className="h-11 px-7 font-semibold shrink-0">
              {loading ? <span className="animate-pulse">Scanning…</span> : t('home.cta')}
              {!loading && <ChevronRight className="size-4 ml-1" />}
            </Button>
          </form>

          {/* Animated scan progress */}
          {loading && (
            <div className="mt-4 max-w-xl mx-auto">
              <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
                <span className="inline-block size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="inline-block size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="inline-block size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="ml-2 text-xs font-medium transition-all duration-300">{SCAN_STEPS[scanStep]}</span>
              </div>
              <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-1000"
                  style={{ width: `${((scanStep + 1) / SCAN_STEPS.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Personalise toggle */}
          <div className="max-w-xl mx-auto mt-3">
            <button
              type="button"
              onClick={() => setShowPersonalise(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              <span className="text-[10px]">{showPersonalise ? '▾' : '▸'}</span>
              Personalise scan (optional — industry &amp; region)
            </button>

            {showPersonalise && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <select
                  value={industry}
                  onChange={e => setIndustry(e.target.value)}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Industry (default: General)</option>
                  <option value="technology">Technology</option>
                  <option value="finance">Finance &amp; Banking</option>
                  <option value="medical">Healthcare &amp; Medical</option>
                  <option value="legal">Legal &amp; Compliance</option>
                  <option value="retail_ecommerce">Retail &amp; E-Commerce</option>
                  <option value="education">Education</option>
                  <option value="real_estate">Real Estate</option>
                  <option value="travel_hospitality">Travel &amp; Hospitality</option>
                  <option value="media_entertainment">Media &amp; Entertainment</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="energy_utilities">Energy &amp; Utilities</option>
                  <option value="general_b2b">General (B2B)</option>
                  <option value="general_b2c">General (B2C)</option>
                </select>
                <select
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Region (default: Global)</option>
                  <option value="HK">Hong Kong</option>
                  <option value="TW">Taiwan</option>
                  <option value="SG">Singapore</option>
                  <option value="JP">Japan</option>
                  <option value="KR">South Korea</option>
                  <option value="US">United States</option>
                  <option value="UK">United Kingdom</option>
                  <option value="EU">European Union</option>
                  <option value="AU">Australia</option>
                  <option value="CA">Canada</option>
                  <option value="global">Global</option>
                </select>
              </div>
            )}
          </div>

          {error && (
            <p className="text-destructive text-sm mt-3">{error}</p>
          )}
        </section>

        {/* ── AI Platform strip ────────────────────────────────── */}
        <section className="border-y bg-muted/30 py-5">
          <div className="max-w-3xl mx-auto px-6">
            <p className="text-xs text-muted-foreground text-center mb-4 tracking-widest font-semibold uppercase">
              {t('home.platforms_label')}
            </p>
            <div className="flex items-center justify-center gap-6 flex-wrap">
              {AI_PLATFORMS.map(p => (
                <div key={p.name} className="flex items-center gap-1.5">
                  <div className="size-2 rounded-full" style={{ background: p.color }} />
                  <span className="text-sm font-medium text-muted-foreground">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Stats bar ───────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-14">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-center">
            {STATS.map(s => (
              <div key={s.label}>
                <div className="text-3xl font-black text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="bg-muted/30 border-y py-16">
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="text-2xl font-black text-foreground text-center mb-2">
              {t('home.how_title')}
            </h2>
            <p className="text-muted-foreground text-center text-sm mb-12">
              {t('home.how_subtitle')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              {STEPS.map((step, i) => (
                <div key={step.num} className="relative">
                  {/* connector line */}
                  {i < STEPS.length - 1 && (
                    <div className="hidden sm:block absolute top-5 left-[calc(100%_-_16px)] w-full h-px border-t border-dashed border-border" />
                  )}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="size-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
                      <span className="text-xs font-black text-primary-foreground">{step.num}</span>
                    </div>
                    <h3 className="font-bold text-foreground text-sm">{step.title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-13">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 100-Point Score breakdown ────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            {/* Text side */}
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary tracking-widest mb-4">
                <Award className="size-3.5" />
                {t('home.score_label')}
              </span>
              <h2 className="text-3xl font-black text-foreground mb-4 leading-tight">
                {t('home.score_title')}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed mb-8">
                {t('home.score_body')}
              </p>
              <div className="space-y-3">
                {SCORE_BREAKDOWN.map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-foreground">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.pts} pts · {item.checks}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${item.color}`}
                        style={{ width: `${item.pts}%` }}
                      />
                    </div>
                  </div>
                ))}
                {/* Total bar */}
                <div className="pt-2 border-t">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-foreground">Total AISO Score</span>
                    <span className="text-xs font-black text-primary">100 pts</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Grade card side */}
            <div className="flex items-center justify-center">
              <div className="relative">
                {/* Grade card */}
                <div className="bg-card border-2 border-primary/20 rounded-2xl p-10 text-center shadow-xl w-64">
                  <div className="text-xs font-bold text-muted-foreground tracking-widest mb-2">AISO GRADE</div>
                  <div className="text-8xl font-black text-primary leading-none mb-2">A<span className="text-4xl align-top mt-3 inline-block">+</span></div>
                  <div className="text-xs text-muted-foreground mb-6">Score 90–100 / 100</div>
                  <div className="flex justify-center gap-1">
                    {['A+','A','B','C','D','F'].map((g, i) => (
                      <div
                        key={g}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                      >
                        {g}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Floating badges */}
                <div className="absolute -top-3 -right-4 bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow">
                  ✓ GEO Pass
                </div>
                <div className="absolute -bottom-3 -left-4 bg-violet-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow">
                  ✓ Tier 1 Authority
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="bg-muted/30 border-t py-16">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl font-black text-foreground text-center mb-2">
              {t('home.features_title')}
            </h2>
            <p className="text-muted-foreground text-center text-sm mb-12">
              {t('home.features_subtitle')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map(({ icon: Icon, title, body, accent, badge }) => (
                <div
                  key={title}
                  className="bg-card rounded-2xl border p-6 space-y-3 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`size-10 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center shrink-0`}>
                      <Icon className="size-5 text-foreground/70" />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                      {badge}
                    </span>
                  </div>
                  <h3 className="font-bold text-foreground text-sm leading-snug">{title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Authority Engine detail ──────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 py-16">
          <div className="bg-card border rounded-2xl overflow-hidden">
            <div className="px-8 py-6 border-b bg-muted/30">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="size-4 text-primary" />
                <span className="text-xs font-bold text-primary tracking-widest">AUTHORITY ENGINE</span>
              </div>
              <h2 className="text-xl font-black text-foreground">{t('home.authority_title')}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t('home.authority_subtitle')}</p>
            </div>
            <div className="divide-y">
              {[
                { layer: 'L1', name: 'TLD Trust',         desc: 'gov · mil · edu · ac · org score higher. Country-code TLDs get regional weight.',      score: '0–10 pts' },
                { layer: 'L2', name: 'Domain Signals',    desc: 'Wikipedia presence, Tranco traffic rank, editorial policy, HTTPS, author bylines.',     score: '0–10 pts' },
                { layer: 'L3', name: 'Industry Pack',     desc: '13 curated industry packs with Tier 1/2/3 domain lists and topical keyword matching.',   score: '0–10 pts × multiplier' },
                { layer: 'L4', name: 'Regional Pack',     desc: '11 regional markets: HK, TW, SG, JP, KR, US, UK, EU, AU, CA, Global.',                  score: '0–10 pts' },
                { layer: 'L5', name: 'Dynamic Learning',  desc: 'Z-score boost from real AI citation frequency — updated weekly via Pulse.',               score: 'up to +5 pts' },
              ].map(({ layer, name, desc, score }) => (
                <div key={layer} className="flex items-start gap-4 px-8 py-4 hover:bg-muted/20 transition-colors">
                  <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-black text-primary">{layer}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-foreground">{name}</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{score}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pulse / Citation Loop ────────────────────────────── */}
        <section className="bg-muted/30 border-t border-b py-16">
          <div className="max-w-4xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              {/* Visual */}
              <div className="relative">
                <div className="bg-card border rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="size-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">AI Pulse — Share of Voice</span>
                    <span className="ml-auto text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">LIVE</span>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { platform: 'Perplexity', pct: 34, color: '#6c6eed' },
                      { platform: 'ChatGPT',    pct: 28, color: '#10a37f' },
                      { platform: 'Claude',     pct: 22, color: '#d97706' },
                      { platform: 'Gemini',     pct: 16, color: '#4285f4' },
                    ].map(p => (
                      <div key={p.platform} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 shrink-0">{p.platform}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                        </div>
                        <span className="text-xs font-bold text-foreground w-8 text-right">{p.pct}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t flex items-center gap-2">
                    <Star className="size-3 text-primary" />
                    <span className="text-xs text-muted-foreground">Citations feed back into Authority Layer 5</span>
                  </div>
                </div>
              </div>

              {/* Text */}
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary tracking-widest mb-4">
                  <BarChart2 className="size-3.5" />
                  {t('home.pulse_label')}
                </span>
                <h2 className="text-3xl font-black text-foreground mb-4 leading-tight">
                  {t('home.pulse_title')}
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  {t('home.pulse_body')}
                </p>
                <ul className="space-y-2">
                  {[
                    'Weekly share-of-voice across 6 AI platforms',
                    'Missed opportunity detection',
                    'Competitor citation benchmarking',
                    'Feeds Layer 5 dynamic authority boost',
                  ].map(item => (
                    <li key={item} className="flex items-center gap-2 text-sm text-foreground">
                      <div className="size-1.5 rounded-full bg-primary shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ───────────────────────────────────────── */}
        <section className="max-w-2xl mx-auto px-6 py-20 text-center">
          <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold tracking-widest px-4 py-1.5 rounded-full mb-6">
            <Zap className="size-3" />
            {t('home.cta_bottom_badge')}
          </span>
          <h2 className="text-4xl font-black text-foreground mb-4">
            {t('home.cta_bottom_title')}
          </h2>
          <p className="text-muted-foreground mb-10">{t('home.cta_bottom_body')}</p>
          <form onSubmit={handleScan} className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto">
            <Input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('home.placeholder')}
              className="flex-1 h-11 text-sm border-2 border-primary/40 focus-visible:border-primary"
              required
            />
            <Button type="submit" disabled={loading} className="h-11 px-7 font-semibold shrink-0">
              {loading ? '…' : t('home.cta')}
              {!loading && <ChevronRight className="size-4 ml-1" />}
            </Button>
          </form>
          {error && <p className="text-destructive text-sm mt-3">{error}</p>}
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="border-t bg-muted/30 py-8 px-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="size-4 rounded bg-primary flex items-center justify-center">
                <Zap className="size-2.5 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">Fimmick <span className="text-primary">AISO</span> Platform</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href={`/${params.lang}/pricing`} className="hover:text-foreground transition-colors">Pricing</Link>
              <Link href={`/${params.lang}/auth/login`} className="hover:text-foreground transition-colors">Sign in</Link>
              <Link href={`/${otherLang}`} className="hover:text-foreground transition-colors">{otherLabel}</Link>
            </div>
            <span>© 2026 Fimmick. AI Search Optimization.</span>
          </div>
        </footer>

      </main>
    </div>
  )
}
