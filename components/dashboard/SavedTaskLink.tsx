import Link from 'next/link'
import { ArrowRight, NotebookPen } from 'lucide-react'

/**
 * One saved-discussion row on a task card. It links to the exact saved Studio
 * thread, not a new thread or a chat-only copy. The labels come from the
 * calling page so the row keeps the surrounding card's voice in both locales.
 */
export type SavedTaskLinkProps =
  | { state: 'ready'; href: string; title: string; when: string | null; label: string }
  | { state: 'unavailable'; label: string }

export function SavedTaskLink(props: SavedTaskLinkProps) {
  if (props.state === 'unavailable') {
    return <p role="status" className="mt-3 border-t border-primary/20 pt-3 text-xs font-medium text-muted-foreground">{props.label}</p>
  }
  return <Link
    href={props.href}
    prefetch={false}
    className="mt-3 flex min-h-11 min-w-0 items-center gap-3 border-t border-primary/20 pt-3 text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  >
    <NotebookPen aria-hidden="true" className="size-4 shrink-0 text-primary-accessible" />
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-semibold uppercase tracking-wider text-primary-accessible">{props.label}</span>
      <span className="mt-0.5 block break-words">{props.title}</span>
    </span>
    {props.when && <span className="shrink-0 text-xs font-medium text-muted-foreground">{props.when}</span>}
    <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
  </Link>
}
