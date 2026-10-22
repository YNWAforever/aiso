'use client'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export interface DataTableColumn<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Value used for sorting and filtering. Columns without one are not sortable. */
  value?: (row: T) => string | number
  align?: 'left' | 'right'
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  getRowId: (row: T) => string
  /** Names the table for assistive tech. */
  caption: string
  /** Shows a text filter over every column that has a `value`. */
  filterable?: boolean
  /** Rendered instead of the table when there are no rows at all. */
  empty?: ReactNode
  className?: string
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

/**
 * Sortable, filterable table that becomes a stack of cards below 640 px. Both
 * renderings are in the DOM and the inactive one is display:none, so assistive
 * tech only ever meets one of them.
 */
export function DataTable<T>({ columns, rows, getRowId, caption, filterable, empty, className }: DataTableProps<T>) {
  const t = useTranslations('ui.table')
  const [sort, setSort] = useState<Sort>(null)
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? rows.filter(row => columns.some(col => col.value && String(col.value(row)).toLowerCase().includes(needle)))
      : [...rows]
    const column = sort && columns.find(col => col.key === sort.key)
    if (column?.value) {
      const get = column.value
      filtered.sort((a, b) => {
        const x = get(a), y = get(b)
        const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
        return sort!.dir === 'asc' ? order : -order
      })
    }
    return filtered
  }, [rows, columns, sort, query])

  if (!rows.length && empty) return <>{empty}</>

  function toggle(key: string) {
    setSort(current => current?.key !== key ? { key, dir: 'asc' } : current.dir === 'asc' ? { key, dir: 'desc' } : null)
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {filterable && (
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">{t('filter')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('filter')}
            className="h-9 w-full rounded-md border border-border bg-input pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}
      <p aria-live="polite" className="sr-only">{t('count', { shown: visible.length, total: rows.length })}</p>

      <div role="region" aria-label={caption} tabIndex={0} className="relative hidden overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border bg-neutral-2 text-left">
            <tr>
              {columns.map(col => {
                const active = sort?.key === col.key
                const Icon = !active ? ArrowUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-4 py-2.5 font-semibold text-muted-foreground', col.align === 'right' && 'text-right')}
                  >
                    {col.value ? (
                      <button type="button" onClick={() => toggle(col.key)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {col.header}
                        <Icon aria-hidden="true" className="size-3.5" />
                      </button>
                    ) : col.header}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={getRowId(row)} className="border-b border-border last:border-0 hover:bg-neutral-2">
                {columns.map(col => (
                  <td key={col.key} className={cn('px-4 py-3 text-foreground', col.align === 'right' && 'text-right tabular-nums')}>{col.cell(row)}</td>
                ))}
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">{t('noMatches')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="flex flex-col gap-2 sm:hidden">
        {visible.map(row => (
          <li key={getRowId(row)} className="rounded-xl border border-border bg-card p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {columns.map(col => (
                <div key={col.key} className="contents">
                  <dt className="text-muted-foreground">{col.header}</dt>
                  <dd className="text-right text-foreground">{col.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {!visible.length && <li className="py-6 text-center text-sm text-muted-foreground">{t('noMatches')}</li>}
      </ul>
    </div>
  )
}
