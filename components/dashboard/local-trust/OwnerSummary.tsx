type Props = {
  title?: string
  summary: string
}

export function OwnerSummary({ title = 'Owner Summary', summary }: Props) {
  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{title}</p>
      <p className="mt-3 text-sm leading-relaxed text-dash-text">{summary}</p>
    </section>
  )
}
