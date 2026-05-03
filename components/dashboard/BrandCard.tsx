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
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5 hover:border-[#00d4ff30] hover:bg-[#111122] transition-all duration-200">
        <div className="flex items-start justify-between mb-3">
          <div className="w-9 h-9 rounded-lg bg-[#00d4ff10] flex items-center justify-center">
            <BarChart2 className="w-4 h-4 text-[#00d4ff]" />
          </div>
          {client.industry && (
            <span className="text-[10px] font-medium text-[#5c5c6e] bg-[#141422] px-2 py-0.5 rounded border border-[#1e1e30]">
              {client.industry}
            </span>
          )}
        </div>
        <p className="font-semibold text-[#e0e0ec] text-sm group-hover:text-[#00d4ff] transition-colors">
          {client.brand_name}
        </p>
        {client.domain && (
          <p className="text-[11px] text-[#5c5c6e] mt-0.5 font-mono">{client.domain}</p>
        )}
        {sovScore !== undefined && (
          <div className="mt-4 pt-3 border-t border-[#1e1e30]">
            <p className="text-2xl font-bold font-mono text-[#a78bfa]">
              {sovScore}%
              <span className="text-[10px] font-normal text-[#5c5c6e] ml-1">SoV</span>
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}
