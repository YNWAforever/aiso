'use client'

import { useTranslations } from 'next-intl'

import { TRUST_SIGNAL_KEYS, type TrustSignalKey, type TrustSignalStatus } from '@/lib/trust-signals'

const STATUSES: readonly TrustSignalStatus[] = ['pass', 'warn', 'fail']
const MARK: Record<TrustSignalStatus, string> = { pass: '✓', warn: '!', fail: '✕' }
const TONE: Record<TrustSignalStatus, string> = {
  pass: 'bg-emerald-50 text-emerald-800',
  warn: 'bg-amber-50 text-amber-900',
  fail: 'bg-rose-50 text-rose-800',
}

/** The stored value, validated: scans from before 2026-10-10 have none, and stored JSON is never trusted blind. */
function parse(value: unknown): { key: TrustSignalKey; status: TrustSignalStatus }[] | null {
  const signals = (value as { signals?: unknown } | null)?.signals
  if (!Array.isArray(signals)) return null
  const valid = signals.filter((s): s is { key: TrustSignalKey; status: TrustSignalStatus } =>
    !!s && TRUST_SIGNAL_KEYS.includes((s as { key: TrustSignalKey }).key)
    && STATUSES.includes((s as { status: TrustSignalStatus }).status))
  return valid.length ? valid : null
}

/**
 * Trust and E-E-A-T signals for the scanned page (lib/trust-signals.ts).
 * Guidance only: the section says so, because none of it is in the score.
 */
export function TrustSignalsSection({ value }: { value: unknown }) {
  const t = useTranslations('trustSignals')
  const signals = parse(value)
  if (!signals) return null
  const present = signals.filter(s => s.status === 'pass').length

  return (
    <section aria-labelledby="trust-signals-title" className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trust-signals-title" className="text-base font-bold text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-600">{t('summary', { count: present, total: signals.length })}</p>
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-600">{t('intro')}</p>
      <ul className="mt-4 space-y-3">
        {signals.map(({ key, status }) => (
          <li key={key} className="flex gap-3">
            <span aria-hidden="true" className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${TONE[status]}`}>
              {MARK[status]}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {t(`${key}_label`)} <span className="font-normal text-slate-600">· {t(`status_${status}`)}</span>
              </p>
              {status !== 'pass' && <p className="mt-0.5 text-sm text-slate-600">{t(`${key}_fix`)}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
