'use client'

import { useId, useState } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

export type ScanFormProps = { lang: string }

export function normalizeSubmittedUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('empty_url')
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const parsed = new URL(withProtocol)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_protocol')
  return parsed.toString()
}

const INDUSTRIES = [
  'technology',
  'finance',
  'medical',
  'legal',
  'retail_ecommerce',
  'education',
  'real_estate',
  'travel_hospitality',
  'media_entertainment',
  'manufacturing',
  'energy',
  'general_b2b',
  'general_b2c',
] as const

const REGIONS = ['HK', 'TW', 'SG', 'JP', 'KR', 'US', 'UK', 'EU', 'AU', 'CA', 'global'] as const

const REGION_KEYS = {
  HK: 'hk',
  TW: 'tw',
  SG: 'sg',
  JP: 'jp',
  KR: 'kr',
  US: 'us',
  UK: 'uk',
  EU: 'eu',
  AU: 'au',
  CA: 'ca',
  global: 'global',
} as const

export function ScanForm({ lang }: ScanFormProps) {
  const t = useTranslations('home')
  const router = useRouter()
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const urlId = `scan-url-${instanceId}`
  const optionsId = `scan-options-${instanceId}`
  const industryId = `scan-industry-${instanceId}`
  const regionId = `scan-region-${instanceId}`
  const [url, setUrl] = useState('')
  const [industry, setIndustry] = useState('')
  const [region, setRegion] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [hasError, setHasError] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setHasError(false)

    let normalizedUrl: string
    try {
      normalizedUrl = normalizeSubmittedUrl(url)
    } catch (error) {
      setHasError(true)
      setStatus(error instanceof Error && error.message === 'empty_url' ? t('url_required') : t('url_invalid'))
      return
    }

    setIsSubmitting(true)
    setStatus(t('scan_loading'))

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: normalizedUrl,
          industry: industry || undefined,
          region: region || undefined,
        }),
      })

      if (!response.ok) throw new Error('scan_failed')
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string') {
        throw new Error('invalid_response')
      }
      setStatus(t('scan_complete'))
      router.push(`/${lang}/result/${data.id}`)
    } catch {
      setHasError(true)
      setStatus(t('scan_error_action'))
      setIsSubmitting(false)
    }
  }

  return (
    <form className="w-full" onSubmit={handleSubmit} noValidate>
      <label htmlFor={urlId} className="mb-2 block text-sm font-semibold text-foreground">
        {t('website_url')}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={urlId}
          type="url"
          name="url"
          autoComplete="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('placeholder')}
          disabled={isSubmitting}
          aria-invalid={hasError}
          className="h-12 min-w-0 flex-1 rounded-xl border-2 border-input bg-card px-4 text-base text-foreground shadow-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:cursor-wait disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md shadow-primary/20 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
        >
          {isSubmitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
          {isSubmitting ? t('scanning') : t('cta')}
        </button>
      </div>

      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={optionsId}
        onClick={() => setIsExpanded((value) => !value)}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
        {t('personalise_toggle')}
      </button>

      <div id={optionsId} hidden={!isExpanded} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={industryId} className="mb-1.5 block text-sm font-medium text-foreground">
            {t('industry_placeholder')}
          </label>
          <select
            id={industryId}
            name="industry"
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            disabled={isSubmitting}
            className="h-12 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/15"
          >
            <option value="">{t('select_not_specified')}</option>
            {INDUSTRIES.map((value) => (
              <option key={value} value={value}>{t(`industry_${value}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={regionId} className="mb-1.5 block text-sm font-medium text-foreground">
            {t('region_placeholder')}
          </label>
          <select
            id={regionId}
            name="region"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            disabled={isSubmitting}
            className="h-12 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/15"
          >
            <option value="">{t('select_not_specified')}</option>
            {REGIONS.map((value) => (
              <option key={value} value={value}>{t(`region_${REGION_KEYS[value]}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`mt-3 min-h-6 text-sm font-medium ${hasError ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {status}
      </p>
    </form>
  )
}
