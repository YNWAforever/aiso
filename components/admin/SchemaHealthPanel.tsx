'use client'
import { useTranslations } from 'next-intl'
import type { SchemaHealth } from '@/lib/admin/schema-health'

export function SchemaHealthPanel({ health }: { health: SchemaHealth }) {
  const t = useTranslations('adminDirectory.schemaHealth')
  return <section aria-labelledby="admin-schema-title" className="rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-900">
    <h2 id="admin-schema-title" className="font-semibold">{t('title')}</h2>
    <p role="status" className="mt-2 font-medium">{t(health.status)}</p>
    <p className="mt-2 text-slate-600">{t('scope')}</p>
    {health.status !== 'columns_present' && <p className="mt-2 text-amber-900">{t('nextStep')}</p>}
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">{t('details')}</summary>
      <p className="break-words text-xs text-slate-600">{t('checkedAt')} <time dateTime={health.checkedAt}>{health.checkedAt}</time></p>
      <ul className="mt-3 space-y-3">{health.checks.map(check => <li key={check.key}>
        <p className="font-medium">{t(`capabilities.${check.key}`)}: {t(check.missing.length ? 'missing' : 'present')}</p>
        {check.missing.length > 0 && <p className="mt-1 break-all font-mono text-xs text-slate-600">{check.missing.join(', ')}</p>}
      </li>)}</ul>
    </details>
  </section>
}
