'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LocalTrustProfile } from '@/lib/types'

type Copy = {
  title: string
  description: string
  primaryServicesLabel: string
  serviceAreaLabel: string
  averageLeadValueLabel: string
  closeRateLabel: string
  competitorsLabel: string
  saveLabel: string
  savingLabel: string
  errorMessage: string
}

type Props = {
  clientId: string
  profile: LocalTrustProfile | null
  copy?: Partial<Copy>
}

export type LocalTrustSetupValues = {
  primaryServices: string
  serviceArea: string
  averageLeadValue: string
  closeRate: string
  competitors: string
}

type LocalTrustSetupPayload = {
  primary_services: string[]
  service_area: string
  average_lead_value: number | null
  close_rate: number | null
  competitors: string[]
}

type SubmitLocalTrustSetupOptions = {
  clientId: string
  values: LocalTrustSetupValues
  errorMessage: string
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  onSavingChange?: (isSaving: boolean) => void
  onError?: (message: string | null) => void
  onReconcile?: (values: LocalTrustSetupValues) => void
  onRefresh?: () => void
}

type SubmitLocalTrustSetupResult =
  | { ok: true; profile: LocalTrustProfile | null }
  | { ok: false; error: string }

const defaultCopy: Copy = {
  title: 'Set up Local Trust ROI',
  description: 'Add your services, service area, and lead assumptions to unlock clearer ROI estimates.',
  primaryServicesLabel: 'Primary services',
  serviceAreaLabel: 'Service area',
  averageLeadValueLabel: 'Average lead value',
  closeRateLabel: 'Close rate',
  competitorsLabel: 'Competitors',
  saveLabel: 'Save assumptions',
  savingLabel: 'Saving...',
  errorMessage: 'Something went wrong. Please try again.',
}

function commaList(value: string) {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function nullableNonNegativeNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const number = Number(trimmed)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function profileToFormValues(profile: LocalTrustProfile): LocalTrustSetupValues {
  return {
    primaryServices: profile.primary_services.join(', '),
    serviceArea: profile.service_area ?? '',
    averageLeadValue: profile.average_lead_value?.toString() ?? '',
    closeRate: profile.close_rate?.toString() ?? '',
    competitors: profile.competitors.join(', '),
  }
}

function buildPayload(values: LocalTrustSetupValues): LocalTrustSetupPayload {
  return {
    primary_services: commaList(values.primaryServices),
    service_area: values.serviceArea,
    average_lead_value: nullableNonNegativeNumber(values.averageLeadValue),
    close_rate: nullableNonNegativeNumber(values.closeRate),
    competitors: commaList(values.competitors),
  }
}

async function readProfile(response: Response): Promise<LocalTrustProfile | null> {
  try {
    const body = await response.json()
    if (!body || typeof body !== 'object' || !('profile' in body)) return null
    return body.profile as LocalTrustProfile | null
  } catch {
    return null
  }
}

export async function submitLocalTrustSetup({
  clientId,
  values,
  errorMessage,
  fetcher = fetch,
  onSavingChange,
  onError,
  onReconcile,
  onRefresh,
}: SubmitLocalTrustSetupOptions): Promise<SubmitLocalTrustSetupResult> {
  onSavingChange?.(true)
  onError?.(null)

  try {
    const response = await fetcher(`/api/dashboard/clients/${encodeURIComponent(clientId)}/local-trust/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(values)),
    })

    if (!response.ok) {
      onError?.(errorMessage)
      return { ok: false, error: errorMessage }
    }

    const savedProfile = await readProfile(response)
    if (savedProfile) {
      onReconcile?.(profileToFormValues(savedProfile))
    }
    onRefresh?.()

    return { ok: true, profile: savedProfile }
  } catch {
    onError?.(errorMessage)
    return { ok: false, error: errorMessage }
  } finally {
    onSavingChange?.(false)
  }
}

export function LocalTrustSetupForm({ clientId, profile, copy }: Props) {
  const router = useRouter()
  const labels = { ...defaultCopy, ...copy }
  const [primaryServices, setPrimaryServices] = useState(profile?.primary_services.join(', ') ?? '')
  const [serviceArea, setServiceArea] = useState(profile?.service_area ?? '')
  const [averageLeadValue, setAverageLeadValue] = useState(profile?.average_lead_value?.toString() ?? '')
  const [closeRate, setCloseRate] = useState(profile?.close_rate?.toString() ?? '')
  const [competitors, setCompetitors] = useState(profile?.competitors.join(', ') ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitLocalTrustSetup({
      clientId,
      values: {
        primaryServices,
        serviceArea,
        averageLeadValue,
        closeRate,
        competitors,
      },
      errorMessage: labels.errorMessage,
      onSavingChange: setIsSaving,
      onError: setError,
      onReconcile: values => {
        setPrimaryServices(values.primaryServices)
        setServiceArea(values.serviceArea)
        setAverageLeadValue(values.averageLeadValue)
        setCloseRate(values.closeRate)
        setCompetitors(values.competitors)
      },
      onRefresh: () => router.refresh(),
    })
  }

  const inputClass = 'min-h-11 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2.5 text-sm text-dash-text outline-none transition focus:border-dash-accent focus-visible:border-dash-accent focus-visible:ring-2 focus-visible:ring-dash-accent/30 disabled:cursor-not-allowed disabled:opacity-60'
  const labelClass = 'text-xs font-semibold text-dash-text'

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-dash-muted">{labels.description}</p>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className={labelClass} htmlFor="local-trust-primary-services">{labels.primaryServicesLabel}</label>
            <input
              id="local-trust-primary-services"
              name="primary_services"
              className={inputClass}
              value={primaryServices}
              onChange={event => setPrimaryServices(event.target.value)}
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-1.5">
            <label className={labelClass} htmlFor="local-trust-service-area">{labels.serviceAreaLabel}</label>
            <input
              id="local-trust-service-area"
              name="service_area"
              className={inputClass}
              value={serviceArea}
              onChange={event => setServiceArea(event.target.value)}
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-1.5">
            <label className={labelClass} htmlFor="local-trust-average-lead-value">{labels.averageLeadValueLabel}</label>
            <input
              id="local-trust-average-lead-value"
              name="average_lead_value"
              className={inputClass}
              value={averageLeadValue}
              onChange={event => setAverageLeadValue(event.target.value)}
              inputMode="decimal"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-1.5">
            <label className={labelClass} htmlFor="local-trust-close-rate">{labels.closeRateLabel}</label>
            <input
              id="local-trust-close-rate"
              name="close_rate"
              className={inputClass}
              value={closeRate}
              onChange={event => setCloseRate(event.target.value)}
              inputMode="decimal"
              disabled={isSaving}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <label className={labelClass} htmlFor="local-trust-competitors">{labels.competitorsLabel}</label>
            <input
              id="local-trust-competitors"
              name="competitors"
              className={inputClass}
              value={competitors}
              onChange={event => setCompetitors(event.target.value)}
              disabled={isSaving}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dash-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
          >
            {isSaving ? labels.savingLabel : labels.saveLabel}
          </button>
          {error ? <p className="text-xs font-medium text-dash-danger" role="alert">{error}</p> : null}
        </div>
      </form>
    </section>
  )
}
