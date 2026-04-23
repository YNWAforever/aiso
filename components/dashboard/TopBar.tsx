interface Props {
  title: string
  subtitle?: string
}

export function TopBar({ title, subtitle }: Props) {
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
      <div>
        <h1 className="font-semibold text-slate-900 text-sm">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
    </header>
  )
}
