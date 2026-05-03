import Link from 'next/link'
import { BarChart2 } from 'lucide-react'
import type { Client } from '@/lib/types'

interface Props {
  client: Client
  lang: string
  sovScore?: number
}

export function BrandCard({ client, lang, sovScore }: Props) {
  return (
    <Link href={`/${lang}/dashboard/${client.id}`} className="group block">
      <div className="rounded-xl border border-dash-border bg-dash-surface p-5 hover:border-dash-accent/20 hover:bg-dash-elevated transition-all duration-200">
        <div className="flex items-start justify-between mb-3">
          <div className="w-9 h-9 rounded-lg bg-dash-accent/10 flex items-center justify-center">
            <BarChart2 className="w-4 h-4 text-dash-accent" />
          </div>
          {client.industry && (
            <span className="text-[10px] font-medium text-dash-muted bg-dash-elevated px-2 py-0.5 rounded border border-dash-border">
              {client.industry}
            </span>
          )}
        </div>
        <p className="font-semibold text-dash-text text-sm group-hover:text-dash-accent transition-colors">
          {client.brand_name}
        </p>
        {client.domain && (
          <p className="text-[11px] text-dash-muted mt-0.5 font-mono">{client.domain}</p>
        )}
        {sovScore !== undefined && (
          <div className="mt-4 pt-3 border-t border-dash-border">
            <p className="text-2xl font-bold font-mono text-dash-purple">
              {sovScore}%
              <span className="text-[10px] font-normal text-dash-muted ml-1">SoV</span>
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}
