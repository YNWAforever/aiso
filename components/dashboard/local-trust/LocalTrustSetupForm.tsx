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
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/local-trust/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_services: commaList(primaryServices),
          service_area: serviceArea,
          average_lead_value: averageLeadValue,
          close_rate: closeRate,
          competitors: commaList(competitors),
        }),
      })

      if (!response.ok) {
        setError(labels.errorMessage)
        return
      }

      router.refresh()
    } catch {
      setError(labels.errorMessage)
    } finally {
      setIsSaving(false)
    }
  }

  const inputClass = 'min-h-11 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2.5 text-sm text-dash-text outline-none transition focus:border-dash-accent disabled:cursor-not-allowed disabled:opacity-60'
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
            className="min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
          >
            {isSaving ? labels.savingLabel : labels.saveLabel}
          </button>
          {error ? <p className="text-xs font-medium text-dash-danger">{error}</p> : null}
        </div>
      </form>
    </section>
  )
}
