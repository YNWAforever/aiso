'use client'

import { FormEvent, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ReportBrandingInput } from '@/lib/reports/types'

type BrandingValues = {
  agencyName: string
  logoUrl: string
  primaryColor: string
  contactLabel: string
  contactUrl: string
}

export type BrandingValidationErrors = Partial<Record<keyof BrandingValues, string>>

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isContactUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

export function validateReportBrandingInput(input: BrandingValues): BrandingValidationErrors {
  const errors: BrandingValidationErrors = {}
  const agencyName = input.agencyName.trim()
  const logoUrl = input.logoUrl.trim()
  const primaryColor = input.primaryColor.trim()
  const contactLabel = input.contactLabel.trim()
  const contactUrl = input.contactUrl.trim()

  if (!agencyName || agencyName.length > 120) errors.agencyName = 'agency_name'
  if (logoUrl && !isHttpsUrl(logoUrl)) errors.logoUrl = 'logo_url'
  if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) errors.primaryColor = 'primary_color'
  if ((contactUrl && !contactLabel) || contactLabel.length > 80) errors.contactLabel = 'contact_pair'
  if ((contactLabel && !contactUrl) || (contactUrl && !isContactUrl(contactUrl))) errors.contactUrl = 'contact_pair'
  return errors
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'FA'
}

function toValues(input: ReportBrandingInput): BrandingValues {
  return {
    agencyName: input.agencyName,
    logoUrl: input.logoUrl ?? '',
    primaryColor: input.primaryColor,
    contactLabel: input.contactLabel ?? '',
    contactUrl: input.contactUrl ?? '',
  }
}

export function ReportBrandingForm({
  initialBranding,
}: {
  initialBranding: ReportBrandingInput
}) {
  const t = useTranslations('reportBranding')
  const [values, setValues] = useState(() => toValues(initialBranding))
  const [errors, setErrors] = useState<BrandingValidationErrors>({})
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)

  const update = (field: keyof BrandingValues, value: string) => {
    setValues(current => ({ ...current, [field]: value }))
    setErrors(current => ({ ...current, [field]: undefined }))
    if (field === 'logoUrl') setLogoFailed(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateReportBrandingInput(values)
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      setNotice(t('validation_summary'))
      return
    }

    setSaving(true)
    setNotice(t('saving'))
    try {
      const response = await fetch('/api/report-branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agencyName: values.agencyName.trim(),
          logoUrl: values.logoUrl.trim() || null,
          primaryColor: values.primaryColor.trim().toUpperCase(),
          contactLabel: values.contactLabel.trim() || null,
          contactUrl: values.contactUrl.trim() || null,
        }),
      })
      if (!response.ok) throw new Error('request failed')
      const body = await response.json() as { branding?: ReportBrandingInput }
      if (body.branding) setValues(toValues(body.branding))
      setNotice(t('saved'))
    } catch {
      setNotice(t('save_error'))
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'min-h-11 focus-visible:ring-2 focus-visible:ring-ring'
  const errorText = (field: keyof BrandingValues) =>
    errors[field] ? <p id={`${field}-error`} role="alert" className="mt-1 text-sm text-destructive">{t(`error_${errors[field]}`)}</p> : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">{t('body')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-5">
            <div>
              <label htmlFor="report-agency-name" className="text-sm font-semibold">{t('agency_name')}</label>
              <Input
                id="report-agency-name"
                className={fieldClass}
                value={values.agencyName}
                onChange={event => update('agencyName', event.target.value)}
                maxLength={120}
                required
                aria-invalid={Boolean(errors.agencyName)}
                aria-describedby={errors.agencyName ? 'agencyName-error' : undefined}
              />
              {errorText('agencyName')}
            </div>

            <div>
              <label htmlFor="report-logo-url" className="text-sm font-semibold">{t('logo_url')}</label>
              <Input
                id="report-logo-url"
                type="url"
                className={fieldClass}
                value={values.logoUrl}
                onChange={event => update('logoUrl', event.target.value)}
                placeholder="https://agency.example/logo.webp"
                aria-invalid={Boolean(errors.logoUrl)}
                aria-describedby={errors.logoUrl ? 'logoUrl-error' : 'report-logo-help'}
              />
              <p id="report-logo-help" className="mt-1 text-sm text-muted-foreground">{t('logo_help')}</p>
              {errorText('logoUrl')}
            </div>

            <div>
              <label htmlFor="report-primary-color" className="text-sm font-semibold">{t('primary_color')}</label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(values.primaryColor) ? values.primaryColor : '#1D4ED8'}
                  onChange={event => update('primaryColor', event.target.value.toUpperCase())}
                  className="size-11 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('color_picker')}
                />
                <Input
                  id="report-primary-color"
                  className={fieldClass}
                  value={values.primaryColor}
                  onChange={event => update('primaryColor', event.target.value)}
                  pattern="^#[0-9A-Fa-f]{6}$"
                  maxLength={7}
                  required
                  aria-invalid={Boolean(errors.primaryColor)}
                  aria-describedby={errors.primaryColor ? 'primaryColor-error' : undefined}
                />
              </div>
              {errorText('primaryColor')}
            </div>

            <fieldset className="space-y-4 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold">{t('contact_legend')}</legend>
              <div>
                <label htmlFor="report-contact-label" className="text-sm font-medium">{t('contact_label')}</label>
                <Input
                  id="report-contact-label"
                  className={fieldClass}
                  value={values.contactLabel}
                  onChange={event => update('contactLabel', event.target.value)}
                  maxLength={80}
                  aria-invalid={Boolean(errors.contactLabel)}
                  aria-describedby={errors.contactLabel ? 'contactLabel-error' : 'report-contact-help'}
                />
                {errorText('contactLabel')}
              </div>
              <div>
                <label htmlFor="report-contact-url" className="text-sm font-medium">{t('contact_url')}</label>
                <Input
                  id="report-contact-url"
                  className={fieldClass}
                  value={values.contactUrl}
                  onChange={event => update('contactUrl', event.target.value)}
                  placeholder="https://agency.example/contact"
                  aria-invalid={Boolean(errors.contactUrl)}
                  aria-describedby={errors.contactUrl ? 'contactUrl-error' : 'report-contact-help'}
                />
                {errorText('contactUrl')}
              </div>
              <p id="report-contact-help" className="text-sm text-muted-foreground">{t('contact_help')}</p>
            </fieldset>

            <div aria-live="polite" className="min-h-6 text-sm">{notice}</div>
            <Button type="submit" className="min-h-11" disabled={saving}>
              {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
              {saving ? t('saving') : t('save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('preview_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center gap-3 p-5">
              {values.logoUrl && !logoFailed ? (
                // Dynamic Agency branding cannot use a build-time Next Image host allowlist.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={values.logoUrl}
                  alt={t('logo_alt', { agency: values.agencyName || t('agency_fallback') })}
                  className="size-12 rounded-xl border border-border object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div
                  className="flex size-12 items-center justify-center rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(values.primaryColor) ? values.primaryColor : '#1D4ED8' }}
                  aria-label={t('initials_fallback')}
                >
                  {initials(values.agencyName)}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{values.agencyName || t('agency_fallback')}</p>
                <p className="text-sm text-muted-foreground">{t('client_report')}</p>
              </div>
            </div>
            <div className="border-t border-border bg-muted/20 px-5 py-4 text-sm font-semibold">
              Powered by Fimmick AISO
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('attribution_help')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
