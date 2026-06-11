'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Label }  from '@/components/ui/label'
import { cn }     from '@/lib/utils'

interface Props {
  lang: string
  disabled?: boolean
  plan?: string
}

const INDUSTRIES = [
  { value: 'Marketing & Advertising', labelKey: 'marketing_advertising' },
  { value: 'Technology',              labelKey: 'technology' },
  { value: 'Finance & Banking',       labelKey: 'finance_banking' },
  { value: 'Healthcare',              labelKey: 'healthcare' },
  { value: 'Retail & E-commerce',     labelKey: 'retail_ecommerce' },
  { value: 'Real Estate',             labelKey: 'real_estate' },
  { value: 'Education',               labelKey: 'education' },
  { value: 'Other',                   labelKey: 'other' },
] as const

export function AddBrandWizard({ lang, disabled, plan }: Props) {
  const t = useTranslations('dashboard')
  const [open, setOpen]               = useState(false)
  const [step, setStep]               = useState(1)
  const [name, setName]               = useState('')
  const [domain, setDomain]           = useState('')
  const [industry, setIndustry]       = useState('')
  const [competitors, setCompetitors] = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const router = useRouter()

  const reset = () => { setStep(1); setName(''); setDomain(''); setIndustry(''); setCompetitors(''); setError('') }
  const close = () => { reset(); setOpen(false) }

  const handleBackdropKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  const submitStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setStep(2)
  }

  const submitStep2 = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/dashboard/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_name:  name.trim(),
        domain:      domain.trim() || null,
        industry:    industry || null,
        competitors: competitors.split(',').map(s => s.trim()).filter(Boolean),
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error === 'BRAND_LIMIT_REACHED'
        ? t('limit_error', { limit: data.limit, plan: data.plan })
        : t('generic_error'))
      setLoading(false); return
    }
    router.refresh(); close(); setLoading(false)
  }

  if (disabled) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
        <p className="text-sm font-semibold text-foreground mb-1">{t('limit_title')}</p>
        <p className="text-xs text-muted-foreground mb-4">
          {t('limit_body', {
            plan: plan ?? 'current',
            allowance: plan === 'basic' ? t('allowance_basic') : plan === 'pro' ? t('allowance_pro') : t('allowance_enterprise'),
          })}
        </p>
        <Button size="sm" asChild>
          <a href={`/${lang}/pricing`}>{t('upgrade_enterprise')}</a>
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-primary hover:text-primary">
        + {t('add_brand')}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onKeyDown={handleBackdropKeyDown}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-brand-title"
            className="bg-card rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 id="add-brand-title" className="text-base font-bold text-foreground">{t('add_brand')}</h2>
                <p className="text-xs text-muted-foreground">{t('wizard_step', { step })}</p>
              </div>
              <button onClick={close} className="text-muted-foreground hover:text-foreground text-2xl leading-none transition-colors">×</button>
            </div>

            {step === 1 && (
              <form onSubmit={submitStep1} className="px-6 py-5 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="brand-name">{t('brand_name_label')}</Label>
                  <Input
                    id="brand-name"
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('brand_name_ph')}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-domain">{t('domain_label')}</Label>
                  <Input
                    id="brand-domain"
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    placeholder={t('domain_ph')}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
                  <Button type="submit" disabled={!name.trim()}>{t('next')}</Button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={submitStep2} className="px-6 py-5 space-y-4">
                {error && <p className="text-destructive text-sm bg-destructive/10 rounded-lg p-3">{error}</p>}
                <div className="space-y-1.5">
                  <Label htmlFor="brand-industry">{t('industry_label')}</Label>
                  <select
                    id="brand-industry"
                    value={industry}
                    onChange={e => setIndustry(e.target.value)}
                    className={cn(
                      'flex h-9 w-full rounded-lg border border-border bg-input px-3 py-1 text-sm text-foreground shadow-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                  >
                    <option value="">{t('industry_ph')}</option>
                    {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{t(`wizard_industries.${i.labelKey}`)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-competitors">{t('competitors_label')}</Label>
                  <Input
                    id="brand-competitors"
                    value={competitors}
                    onChange={e => setCompetitors(e.target.value)}
                    placeholder={t('competitors_ph')}
                  />
                  <p className="text-xs text-muted-foreground">{t('competitors_hint')}</p>
                </div>
                <p className="text-xs text-muted-foreground bg-primary/5 rounded-lg p-3">
                  {t('pulse_note')}
                </p>
                <div className="flex justify-between gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setStep(1)}>{t('back')}</Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? t('adding') : t('add_brand_submit')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
