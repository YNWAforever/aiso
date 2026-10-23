'use client'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { CornerDownLeft, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { DialogOverlay } from '@/components/ui/dialog'

export interface CommandItem {
  id: string
  label: string
  /** Section heading the item is listed under. */
  group?: string
  /** Extra words that should match, e.g. old route names. */
  keywords?: readonly string[]
  href?: string
  onSelect?: () => void
}

export interface CommandPaletteProps {
  items: readonly CommandItem[]
  /** Controlled open state; omit to let ⌘K / Ctrl+K drive it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Groups items under their headings, first-seen group first, and returns the
 * flattened render order alongside. Keyboard navigation must use `ordered`:
 * grouping pulls interleaved items together, so indexing the ungrouped list
 * would highlight one item and run another.
 */
export function groupCommands(items: readonly CommandItem[]) {
  const map = new Map<string, CommandItem[]>()
  for (const item of items) map.set(item.group ?? '', [...(map.get(item.group ?? '') ?? []), item])
  const groups = [...map.entries()]
  return { groups, ordered: groups.flatMap(([, groupItems]) => groupItems) }
}

/**
 * ⌘K / Ctrl+K search over pages and actions. A combobox input controlling a
 * listbox (the WAI-ARIA pattern), built on the dialog primitive rather than a
 * command-menu library.
 */
export function CommandPalette({ items, open: controlled, onOpenChange }: CommandPaletteProps) {
  const t = useTranslations('ui.command')
  const router = useRouter()
  const listId = useId()
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = controlled ?? uncontrolled
  const setOpen = (next: boolean) => { onOpenChange?.(next); if (controlled === undefined) setUncontrolled(next) }
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Opened by a shortcut or a button outside Radix's Trigger, so Radix has
  // nothing to return focus to. Remember what had focus and give it back.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    function onFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement && !event.target.closest('[data-command-palette]')) opener.current = event.target
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenChange?.(!open)
        if (controlled === undefined) setUncontrolled(value => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, controlled, onOpenChange])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter(item => [item.label, item.group ?? '', ...(item.keywords ?? [])].some(text => text.toLowerCase().includes(needle)))
  }, [items, query])

  const { groups, ordered } = useMemo(() => groupCommands(results), [results])

  function choose(item: CommandItem | undefined) {
    if (!item) return
    setOpen(false)
    setQuery('')
    if (item.onSelect) item.onSelect()
    else if (item.href) router.push(item.href)
  }

  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!ordered.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => (i + 1) % ordered.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => (i - 1 + ordered.length) % ordered.length) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
    else if (event.key === 'End') { event.preventDefault(); setActive(ordered.length - 1) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(ordered[active]) }
  }

  const optionId = (index: number) => `${listId}-option-${index}`

  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery('') }}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-command-palette=""
          onCloseAutoFocus={event => {
            if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() }
          }}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-e3 data-[state=open]:animate-[dialog-in_200ms_var(--ease-standard)] data-[state=closed]:animate-[dialog-out_160ms_var(--ease-standard)]"
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length ? optionId(active) : undefined}
              aria-label={t('placeholder')}
              placeholder={t('placeholder')}
              value={query}
              onChange={event => { setQuery(event.target.value); setActive(0) }}
              onKeyDown={onInputKey}
              className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div id={listId} role="listbox" aria-label={t('results')} className="max-h-80 overflow-y-auto p-2">
            {!results.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>}
            {groups.map(([group, groupItems]) => (
              <div key={group || 'ungrouped'} role="group" aria-label={group || undefined} className="flex flex-col">
                {group && <p aria-hidden="true" className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{group}</p>}
                {groupItems.map(item => {
                  const i = ordered.indexOf(item)
                  const selected = i === active
                  return (
                    <div
                      key={item.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(item)}
                      className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm', selected ? 'bg-accent text-accent-foreground' : 'text-foreground')}
                    >
                      {item.label}
                      {selected && <CornerDownLeft aria-hidden="true" className="size-3.5 text-muted-foreground" />}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{t('hint')}</p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
