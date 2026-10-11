'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { DIRECTORY_VIEWS, DIRECTORY_COLUMNS, type DirectoryQuery, type DirectoryResult, type DirectoryRow } from '@/lib/admin/directory-schema'

export function AdminDirectory({ lang, query }: { lang: string; query: DirectoryQuery }) {
  const t = useTranslations('adminDirectory')
  const [result, setResult] = useState<DirectoryResult | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const { view, q, accountId, page } = query
  const params = new URLSearchParams({ view, q, page: String(page), ...(accountId ? { accountId } : {}) }).toString()
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch('/api/admin/directory?' + params, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? 'denied' : 'unavailable')
        const data = await response.json() as DirectoryResult
        if (!Array.isArray(data.rows) || data.view !== view || data.page !== page) throw new Error('unavailable')
        if (!controller.signal.aborted) { setResult(data); setError('') }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error && err.message === 'denied' ? 'denied' : 'unavailable')
      }
    }
    void load()
    return () => controller.abort()
  }, [params, view, page, revision])
  const href = (changes: Partial<DirectoryQuery> = {}) => {
    const next = { ...query, ...changes }
    return '/admin?' + new URLSearchParams({ lang, view: next.view, page: String(next.page), ...(next.q ? { q: next.q } : {}), ...(next.accountId ? { accountId: next.accountId } : {}) })
  }
  const link = 'inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600'
  function cell(row: DirectoryRow, key: string) {
    const value = row[key]
    if (value === null || value === undefined || value === '') return <span className="text-slate-500">{t('unknown')}</span>
    if (key === 'excerpt') return <details className="min-w-56 max-w-lg"><summary className="cursor-pointer py-3 font-medium">{t('readExcerpt')}</summary><p className="whitespace-pre-wrap break-words">{String(value)}</p><p className="mt-2 text-xs text-slate-500">{t('excerptLimit')}</p></details>
    if (typeof value === 'boolean') return t(value ? 'yes' : 'no')
    if (['status', 'role'].includes(key) && t.has(`states.${value}`)) return t(`states.${value}`)
    return String(value)
  }
  return <div className="min-w-0 space-y-6 text-slate-900">
    <header><p className="text-sm font-semibold text-blue-700">{t('eyebrow')}</p><h1 className="mt-2 text-3xl font-bold">{t('title')}</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">{t('intro')}</p></header>
    <nav aria-label={t('controls')} className="flex flex-wrap gap-2">
      <Link href={href({ accountId: null, page: 1 })} className={link}>{t('allAccounts')}</Link>
      <Link href="/admin/billing" className={link}>{t('billing')}</Link>
      <Link href={'/admin?' + new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(params)), lang: lang === 'en' ? 'zh-HK' : 'en' })} className={link}>{lang === 'en' ? '繁體中文' : 'English'}</Link>
    </nav>
    {accountId && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm"><strong>{t('accountScope')}</strong><p className="break-all font-mono">{accountId}</p><Link href={`/admin/accounts/${encodeURIComponent(accountId)}/approvers?lang=${lang}`} className={`${link} mt-2`}>{t('approvers')}</Link></div>}
    <nav aria-label={t('datasets')} className="flex flex-wrap gap-2">{DIRECTORY_VIEWS.map(v => <Link key={v} href={href({ view: v, page: 1, q: '' })} aria-current={v === view ? 'page' : undefined} className={`${link} ${v === view ? 'border-blue-700 bg-blue-50 text-blue-800' : 'bg-white'}`}>{t(`views.${v}`)}</Link>)}</nav>
    <form action="/admin" method="get" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="view" value={view} /><input type="hidden" name="lang" value={lang} />{accountId && <input type="hidden" name="accountId" value={accountId} />}
      <label className="flex-1 text-sm font-medium" htmlFor="admin-search">{t('search')}<input id="admin-search" name="q" defaultValue={q} maxLength={120} className="mt-1 block min-h-11 w-full min-w-44 rounded-lg border border-slate-300 bg-white px-3" /></label>
      <button type="submit" className={link}>{t('searchButton')}</button>
    </form>
    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5"><p>{t(error)}</p><button type="button" onClick={() => { setError(''); setResult(null); setRevision(n => n + 1) }} className={`${link} mt-3`}>{t('retry')}</button></div>
      : !result ? <p role="status">{t('loading')}</p>
      : <section aria-label={t(`views.${view}`)}>
        <p role="status" className="mb-3 text-sm text-slate-600">{t('pageSummary', { page: result.page, count: result.rows.length })}</p>
        {result.rows.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6">{t('empty')}</p> : <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} role="region" aria-label={t('table')}>
          <table className="w-full text-left text-sm"><caption className="sr-only">{t(`views.${view}`)}</caption><thead><tr className="border-b bg-slate-50">{DIRECTORY_COLUMNS[view].map(key => <th scope="col" key={key} className="px-4 py-3 font-semibold">{t(`columns.${key}`)}</th>)}<th scope="col" className="px-4 py-3">{t('account')}</th></tr></thead>
            <tbody>{result.rows.map(row => <tr key={row.id} className="border-b last:border-0">{DIRECTORY_COLUMNS[view].map(key => <td key={key} className="min-w-28 max-w-sm break-words px-4 py-3 align-top">{cell(row, key)}</td>)}<td className="px-4 py-3 align-top">{row.account_id ? <Link href={href({ accountId: row.account_id, page: 1, q: '' })} className={link} aria-label={t('openAccountId', { id: row.account_id })}>{t('openAccount')}</Link> : t('unassigned')}</td></tr>)}</tbody>
          </table>
        </div>}
        <nav aria-label={t('pagination')} className="mt-4 flex flex-wrap gap-3">{page > 1 && <Link href={href({ page: page - 1 })} className={link}>{t('previous')}</Link>}{result.hasMore && <Link href={href({ page: page + 1 })} className={link}>{t('next')}</Link>}</nav>
      </section>}
  </div>
}
