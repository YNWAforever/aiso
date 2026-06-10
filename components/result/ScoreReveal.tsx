'use client'
import { useEffect, useRef, useState } from 'react'
import { INDUSTRY_BENCHMARKS } from '@/lib/impact'

const GRADE_CONFIG: Record<string, { ring: string; badge: string; text: string; label: string }> = {
  'A+': { ring: 'stroke-emerald-500', badge: 'bg-emerald-500', text: 'text-white', label: 'Excellent' },
  'A':  { ring: 'stroke-green-500',   badge: 'bg-green-500',   text: 'text-white', label: 'Very Good' },
  'B':  { ring: 'stroke-blue-500',    badge: 'bg-blue-500',    text: 'text-white', label: 'Good' },
  'C':  { ring: 'stroke-yellow-500',  badge: 'bg-yellow-500',  text: 'text-white', label: 'Fair' },
  'D':  { ring: 'stroke-orange-500',  badge: 'bg-orange-500',  text: 'text-white', label: 'Poor' },
  'F':  { ring: 'stroke-red-500',     badge: 'bg-red-500',     text: 'text-white', label: 'Critical' },
}

const INDUSTRY_LABELS: Record<string, string> = {
  technology: 'Technology', finance: 'Finance', medical: 'Healthcare',
  legal: 'Legal', retail_ecommerce: 'Retail & E-Commerce', education: 'Education',
  real_estate: 'Real Estate', travel_hospitality: 'Travel & Hospitality',
  media_entertainment: 'Media & Entertainment', manufacturing: 'Manufacturing',
  energy_utilities: 'Energy & Utilities', general_b2b: 'General B2B', general_b2c: 'General B2C',
}

interface Props {
  score: number
  grade: string
  domain: string
  industry?: string | null
  region?: string | null
}

export function ScoreReveal({ score, grade, domain, industry, region }: Props) {
  const [displayed, setDisplayed] = useState(0)
  const [visible, setVisible] = useState(false)
  const raf = useRef<number | null>(null)

  const cfg = GRADE_CONFIG[grade] ?? GRADE_CONFIG['F']!
  const benchmark = industry ? (INDUSTRY_BENCHMARKS[industry] ?? 49) : 49
  const industryLabel = industry ? (INDUSTRY_LABELS[industry] ?? industry) : null
  const delta = score - benchmark
  const size = 140
  const r = 56
  const circ = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, displayed)) / 100

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!visible) return
    const start = performance.now()
    const duration = 1200
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const ease = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(ease * score))
      if (progress < 1) raf.current = requestAnimationFrame(animate)
    }
    raf.current = requestAnimationFrame(animate)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [visible, score])

  return (
    <div className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <div className="flex flex-col sm:flex-row items-center gap-8 bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">

        {/* Animated ring */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={10} className="stroke-slate-100" />
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={10}
              className={`${cfg.ring} transition-all duration-1000`}
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct)}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-black text-slate-900 tabular-nums leading-none">{displayed}</span>
            <span className="text-xs text-slate-400 font-medium">/100</span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 text-center sm:text-left">
          <p className="text-xl font-black text-slate-900 mb-1 truncate">{domain}</p>
          {(industryLabel || region) && (
            <p className="text-xs text-slate-400 mb-3">
              {[industryLabel, region].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Grade badge */}
          <div className="inline-flex items-center gap-2 mb-4">
            <span className={`inline-flex items-center gap-1.5 ${cfg.badge} ${cfg.text} font-black text-lg px-4 py-1.5 rounded-xl`}>
              {grade} <span className="text-sm font-semibold opacity-80">— {cfg.label}</span>
            </span>
          </div>

          {/* Benchmark */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Your score</span>
              <span className="font-bold text-slate-900">{score}/100</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Avg. {industryLabel ?? 'industry'}</span>
              <span className="font-semibold text-slate-600">{benchmark}/100</span>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${delta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {delta >= 0 ? `+${delta}` : delta} vs avg
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
