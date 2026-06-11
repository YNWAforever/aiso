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

/* ── Static content (brand/platform names stay in English) ──── */

const AI_PLATFORMS = [
  { name: 'ChatGPT',    color: '#10a37f' },
  { name: 'Perplexity', color: '#6c6eed' },
  { name: 'Claude',     color: '#d97706' },
  { name: 'Gemini',     color: '#4285f4' },
  { name: 'Google AIO', color: '#34a853' },
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
    t('home.scan_step1'),
    t('home.scan_step2'),
    t('home.scan_step3'),
    t('home.scan_step4'),
    t('home.scan_step5'),
    t('home.scan_step6'),
    t('home.scan_step7'),
    t('home.scan_step8'),
    t('home.scan_step9'),
    t('home.scan_step10'),
    t('home.scan_step11'),
  ]

  const STEPS = [
    { num: '01', title: t('home.step1_title'), body: t('home.step1_body') },
    { num: '02', title: t('home.step2_title'), body: t('home.step2_body') },
    { num: '03', title: t('home.step3_title'), body: t('home.step3_body') },
  ]

  const FEATURES = [
    {
      icon: Layers,
      title: t('home.feature_authority_title'),
      body:  t('home.feature_authority_body'),
      accent: 'from-violet-500/20 to-purple-500/10',
      badge: t('home.feature_authority_badge'),
    },
    {
      icon: Search,
      title: t('home.feature_checks_title'),
      body:  t('home.feature_checks_body'),
      accent: 'from-blue-500/20 to-cyan-500/10',
      badge: t('home.feature_checks_badge'),
    },
    {
      icon: Brain,
      title: t('home.feature_citation_title'),
      body:  t('home.feature_citation_body'),
      accent: 'from-emerald-500/20 to-teal-500/10',
      badge: t('home.feature_citation_badge'),
    },
    {
      icon: FileText,
      title: t('home.feature_fixpack_title'),
      body:  t('home.feature_fixpack_body'),
      accent: 'from-orange-500/20 to-amber-500/10',
      badge: t('home.feature_fixpack_badge'),
    },
    {
      icon: BarChart2,
      title: t('home.feature_pulse_title'),
      body:  t('home.feature_pulse_body'),
      accent: 'from-pink-500/20 to-rose-500/10',
      badge: t('home.feature_pulse_badge'),
    },
    {
      icon: Globe,
      title: t('home.feature_intel_title'),
      body:  t('home.feature_intel_body'),
      accent: 'from-sky-500/20 to-indigo-500/10',
      badge: t('home.feature_intel_badge'),
    },
  ]

  const STATS = [
    { value: '20',  label: t('home.stat_checks') },
    { value: '5',   label: t('home.stat_layers') },
    { value: '13',  label: t('home.stat_industries') },
    { value: '11',  label: t('home.stat_regions') },
    { value: '6',   label: t('home.stat_platforms') },
    { value: 'A+',  label: t('home.stat_grade') },
  ]

  const SCORE_BREAKDOWN = [
    { label: t('home.breakdown_core'),     pts: 45, color: 'bg-primary',    checks: 'c1–c5' },
    { label: t('home.breakdown_extended'), pts: 30, color: 'bg-violet-500', checks: 'c6–c16' },
    { label: t('home.breakdown_geo'),      pts: 25, color: 'bg-emerald-500', checks: 'c17–c20' },
  ]

  const AUTHORITY_LAYERS = [
    { layer: 'L1', name: t('home.layer1_title'), desc: t('home.layer1_desc'), score: t('home.layer1_score') },
    { layer: 'L2', name: t('home.layer2_title'), desc: t('home.layer2_desc'), score: t('home.layer2_score') },
    { layer: 'L3', name: t('home.layer3_title'), desc: t('home.layer3_desc'), score: t('home.layer3_score') },
    { layer: 'L4', name: t('home.layer4_title'), desc: t('home.layer4_desc'), score: t('home.layer4_score') },
    { layer: 'L5', name: t('home.layer5_title'), desc: t('home.layer5_desc'), score: t('home.layer5_score') },
  ]

  const PULSE_POINTS = [
    t('home.pulse_point1'),
    t('home.pulse_point2'),
    t('home.pulse_point3'),
    t('home.pulse_point4'),
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
      <nav className="bg-white/90 backdrop-blur-md border-b border-border/60 px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Zap className="size-4 text-white" />
          </div>
          <span className="font-black text-foreground tracking-tight">
            Fimmick <span className="text-primary">AISO</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${params.lang}/auth/login`}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
          >
            {t('nav.sign_in')}
          </Link>
          <Button size="sm" className="rounded-lg px-4 shadow-sm" asChild>
            <Link href={`/${params.lang}/pricing`}>{t('nav.get_started')}</Link>
          </Button>
          <Link href={`/${otherLang}`} className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors border border-border rounded-md px-2 py-1">
            {otherLabel}
          </Link>
        </div>
      </nav>

      <main>

        {/* ── Hero ────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          {/* Background gradient mesh */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-primary/8 via-blue-100/40 to-transparent blur-3xl" />
          </div>

          <div className="max-w-6xl mx-auto px-6 pt-16 pb-12 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left — text + form */}
            <div>
              <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold tracking-widest px-3.5 py-1.5 rounded-full mb-5 border border-primary/20">
                <Zap className="size-3" />
                {t('home.badge')}
              </span>

              <h1 className="text-4xl sm:text-5xl lg:text-5xl font-black text-foreground leading-[1.1] mb-4 whitespace-pre-line">
                {t('home.headline')}
              </h1>
              <p className="text-muted-foreground text-base sm:text-lg mb-2 leading-relaxed max-w-lg">
                {t('home.subheadline')}
              </p>
              <p className="text-sm text-muted-foreground/60 mb-8">{t('home.trust')}</p>

              {/* Scan form */}
              <form onSubmit={handleScan} className="flex flex-col sm:flex-row gap-2 max-w-lg">
                <Input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder={t('home.placeholder')}
                  className="flex-1 h-12 text-sm border-2 border-primary/30 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 rounded-xl shadow-sm"
                  required
                  disabled={loading}
                />
                <Button type="submit" disabled={loading} className="h-12 px-6 font-semibold shrink-0 rounded-xl shadow-sm">
                  {loading ? <span className="animate-pulse">{t('home.scanning')}</span> : t('home.cta')}
                  {!loading && <ChevronRight className="size-4 ml-1" />}
                </Button>
              </form>

              {/* Scan progress */}
              {loading && (
                <div className="mt-3 max-w-lg">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-block size-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="inline-block size-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="inline-block size-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span className="ml-1 transition-all duration-300">{SCAN_STEPS[scanStep]}</span>
                  </div>
                  <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${((scanStep + 1) / SCAN_STEPS.length) * 100}%` }} />
                  </div>
                </div>
              )}

              {/* Personalise toggle */}
              <div className="max-w-lg mt-3">
                <button type="button" onClick={() => setShowPersonalise(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <span className="text-[10px]">{showPersonalise ? '▾' : '▸'}</span>
                  {t('home.personalise_toggle')}
                </button>
                {showPersonalise && (
                  <div className="mt-2 flex flex-col sm:flex-row gap-2">
                    <select value={industry} onChange={e => setIndustry(e.target.value)}
                      className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="">{t('home.industry_placeholder')}</option>
                      <option value="technology">{t('home.industry_technology')}</option>
                      <option value="finance">{t('home.industry_finance')}</option>
                      <option value="medical">{t('home.industry_medical')}</option>
                      <option value="legal">{t('home.industry_legal')}</option>
                      <option value="retail_ecommerce">{t('home.industry_retail')}</option>
                      <option value="education">{t('home.industry_education')}</option>
                      <option value="real_estate">{t('home.industry_real_estate')}</option>
                      <option value="travel_hospitality">{t('home.industry_travel')}</option>
                      <option value="media_entertainment">{t('home.industry_media')}</option>
                      <option value="manufacturing">{t('home.industry_manufacturing')}</option>
                      <option value="energy_utilities">{t('home.industry_energy')}</option>
                      <option value="general_b2b">{t('home.industry_general_b2b')}</option>
                      <option value="general_b2c">{t('home.industry_general_b2c')}</option>
                    </select>
                    <select value={region} onChange={e => setRegion(e.target.value)}
                      className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="">{t('home.region_placeholder')}</option>
                      <option value="HK">{t('home.region_hk')}</option>
                      <option value="TW">{t('home.region_tw')}</option>
                      <option value="SG">{t('home.region_sg')}</option>
                      <option value="JP">{t('home.region_jp')}</option>
                      <option value="KR">{t('home.region_kr')}</option>
                      <option value="US">{t('home.region_us')}</option>
                      <option value="UK">{t('home.region_uk')}</option>
                      <option value="EU">{t('home.region_eu')}</option>
                      <option value="AU">{t('home.region_au')}</option>
                      <option value="CA">{t('home.region_ca')}</option>
                      <option value="global">{t('home.region_global')}</option>
                    </select>
                  </div>
                )}
              </div>
              {error && <p className="text-destructive text-sm mt-3">{error}</p>}
            </div>

            {/* Right — floating score card mockup */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="relative">
                {/* Main score card */}
                <div className="bg-white rounded-2xl border border-border shadow-2xl p-6 w-72">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Zap className="size-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">fimmick.com</p>
                      <p className="text-[10px] text-muted-foreground">{t('home.mockup_meta')}</p>
                    </div>
                    <div className="ml-auto bg-blue-600 text-white text-sm font-black px-2 py-1 rounded-lg">B+</div>
                  </div>
                  {/* Score ring mockup */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="relative size-16">
                      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
                        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="6" className="stroke-slate-100" />
                        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="6" stroke="#2563eb"
                          strokeDasharray="163.4" strokeDashoffset="40" strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-black text-foreground leading-none">74</span>
                        <span className="text-[8px] text-muted-foreground">/100</span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <div>
                        <div className="flex justify-between text-[10px] mb-0.5">
                          <span className="text-muted-foreground">{t('home.breakdown_core')}</span>
                          <span className="font-semibold">38/45</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full"><div className="h-full bg-primary rounded-full" style={{ width:'84%' }} /></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] mb-0.5">
                          <span className="text-muted-foreground">{t('home.breakdown_geo')}</span>
                          <span className="font-semibold">18/25</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full"><div className="h-full bg-emerald-500 rounded-full" style={{ width:'72%' }} /></div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <span className="flex-1 text-center text-[10px] font-semibold py-1 rounded-md bg-emerald-50 text-emerald-700">{t('home.mockup_passing')}</span>
                    <span className="flex-1 text-center text-[10px] font-semibold py-1 rounded-md bg-amber-50 text-amber-700">{t('home.mockup_warnings')}</span>
                    <span className="flex-1 text-center text-[10px] font-semibold py-1 rounded-md bg-red-50 text-red-700">{t('home.mockup_failing')}</span>
                  </div>
                </div>
                {/* Floating badges */}
                <div className="absolute -top-4 -right-4 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-xl shadow-lg flex items-center gap-1">
                  <ShieldCheck className="size-3" /> {t('home.mockup_geo_badge')}
                </div>
                <div className="absolute -bottom-4 -left-4 bg-violet-600 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-xl shadow-lg flex items-center gap-1">
                  <Award className="size-3" /> {t('home.mockup_authority_badge')}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── AI Platform strip ────────────────────────────────── */}
        <section className="border-y border-border/60 bg-white py-4">
          <div className="max-w-4xl mx-auto px-6">
            <p className="text-[10px] text-muted-foreground text-center mb-4 tracking-[0.15em] font-semibold uppercase">
              {t('home.platforms_label')}
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {AI_PLATFORMS.map(p => (
                <span key={p.name}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-border bg-background text-foreground/80">
                  <span className="size-2 rounded-full shrink-0" style={{ background: p.color }} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Stats bar ───────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
            {STATS.map(s => (
              <div key={s.label} className="text-center bg-white rounded-xl border border-border p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-2xl font-black text-primary">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-1 leading-tight font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="bg-gradient-to-b from-slate-50 to-white border-y border-border/60 py-16">
          <div className="max-w-4xl mx-auto px-6">
            <p className="text-xs font-bold text-primary tracking-widest text-center mb-3 uppercase">{t('home.how_label')}</p>
            <h2 className="text-3xl font-black text-foreground text-center mb-2">{t('home.how_title')}</h2>
            <p className="text-muted-foreground text-center text-sm mb-12 max-w-lg mx-auto">{t('home.how_subtitle')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {STEPS.map((step, i) => (
                <div key={step.num} className="relative bg-white rounded-2xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow">
                  {i < STEPS.length - 1 && (
                    <div className="hidden sm:block absolute top-1/2 -right-3 z-10">
                      <ChevronRight className="size-5 text-primary/40" />
                    </div>
                  )}
                  <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                    <span className="text-sm font-black text-primary">{step.num}</span>
                  </div>
                  <h3 className="font-bold text-foreground mb-2">{step.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.body}</p>
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
                      <span className="text-xs text-muted-foreground">{item.pts} {t('home.pts_unit')} · {item.checks}</span>
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
                    <span className="text-xs font-black text-foreground">{t('home.total_label')}</span>
                    <span className="text-xs font-black text-primary">{t('home.total_pts')}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Grade card side */}
            <div className="flex items-center justify-center">
              <div className="relative">
                {/* Grade card */}
                <div className="bg-card border-2 border-primary/20 rounded-2xl p-10 text-center shadow-xl w-64">
                  <div className="text-xs font-bold text-muted-foreground tracking-widest mb-2">{t('home.grade_label')}</div>
                  <div className="text-8xl font-black text-primary leading-none mb-2">A<span className="text-4xl align-top mt-3 inline-block">+</span></div>
                  <div className="text-xs text-muted-foreground mb-6">{t('home.grade_range')}</div>
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
                  {t('home.grade_geo_pass')}
                </div>
                <div className="absolute -bottom-3 -left-4 bg-violet-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow">
                  {t('home.grade_tier1')}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────── */}
        <section className="bg-white border-t border-border/60 py-16">
          <div className="max-w-5xl mx-auto px-6">
            <p className="text-xs font-bold text-primary tracking-widest text-center mb-3 uppercase">{t('home.features_label')}</p>
            <h2 className="text-3xl font-black text-foreground text-center mb-2">{t('home.features_title')}</h2>
            <p className="text-muted-foreground text-center text-sm mb-12 max-w-lg mx-auto">{t('home.features_subtitle')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map(({ icon: Icon, title, body, accent, badge }) => (
                <div key={title}
                  className="group bg-white rounded-2xl border border-border p-6 space-y-3 shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-200">
                  <div className="flex items-start justify-between gap-2">
                    <div className={`size-10 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
                      <Icon className="size-5 text-foreground/80" />
                    </div>
                    <span className="text-[10px] font-bold text-primary/80 bg-primary/8 border border-primary/15 px-2 py-0.5 rounded-full shrink-0">
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
                <span className="text-xs font-bold text-primary tracking-widest">{t('home.authority_label')}</span>
              </div>
              <h2 className="text-xl font-black text-foreground">{t('home.authority_title')}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t('home.authority_subtitle')}</p>
            </div>
            <div className="divide-y">
              {AUTHORITY_LAYERS.map(({ layer, name, desc, score }) => (
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
                    <span className="text-xs font-bold text-foreground">{t('home.pulse_chart_title')}</span>
                    <span className="ml-auto text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">{t('home.pulse_live')}</span>
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
                    <span className="text-xs text-muted-foreground">{t('home.pulse_feedback')}</span>
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
                  {PULSE_POINTS.map(item => (
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
        <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-700 py-20">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-1/4 w-64 h-64 rounded-full bg-white/5 blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-64 h-64 rounded-full bg-white/5 blur-3xl" />
          </div>
          <div className="relative max-w-2xl mx-auto px-6 text-center">
            <span className="inline-flex items-center gap-1.5 bg-white/15 text-white text-xs font-bold tracking-widest px-4 py-1.5 rounded-full mb-6 border border-white/20">
              <Zap className="size-3" />
              {t('home.cta_bottom_badge')}
            </span>
            <h2 className="text-4xl font-black text-white mb-4">{t('home.cta_bottom_title')}</h2>
            <p className="text-blue-100 mb-10 text-lg">{t('home.cta_bottom_body')}</p>
            <form onSubmit={handleScan} className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto">
              <Input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={t('home.placeholder')}
                className="flex-1 h-12 text-sm bg-white/95 border-white/30 text-foreground placeholder:text-muted-foreground focus-visible:ring-white/50 rounded-xl"
                required
              />
              <Button type="submit" disabled={loading}
                className="h-12 px-6 font-semibold shrink-0 rounded-xl bg-white text-primary hover:bg-white/90 shadow-lg">
                {loading ? '…' : t('home.cta')}
                {!loading && <ChevronRight className="size-4 ml-1" />}
              </Button>
            </form>
            {error && <p className="text-red-200 text-sm mt-3">{error}</p>}
            <p className="text-blue-200/70 text-xs mt-5">{t('home.cta_bottom_note')}</p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="border-t border-border bg-white py-8 px-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="size-5 rounded-md bg-primary flex items-center justify-center">
                <Zap className="size-3 text-white" />
              </div>
              <span className="font-bold text-foreground">Fimmick <span className="text-primary">AISO</span></span>
              <span className="text-xs text-muted-foreground">{t('home.footer_tagline')}</span>
            </div>
            <div className="flex items-center gap-5">
              <Link href={`/${params.lang}/pricing`} className="hover:text-foreground transition-colors text-xs">{t('home.footer_pricing')}</Link>
              <Link href={`/${params.lang}/auth/login`} className="hover:text-foreground transition-colors text-xs">{t('home.footer_sign_in')}</Link>
              <Link href={`/${otherLang}`} className="hover:text-foreground transition-colors text-xs border border-border rounded px-2 py-0.5">{otherLabel}</Link>
            </div>
            <span className="text-xs">© 2026 Fimmick.</span>
          </div>
        </footer>

      </main>
    </div>
  )
}
