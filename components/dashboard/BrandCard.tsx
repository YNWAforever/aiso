import Link from 'next/link'
import type { Client } from '@/lib/types'

interface Props {
  client: Client
  lang: string
  sovScore?: number
}

export function BrandCard({ client, lang, sovScore }: Props) {
  return (
    <Link
      href={`/${lang}/dashboard/${client.id}`}
      className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition group"
    >
      <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition">
        {client.brand_name}
      </h3>
      {client.industry && (
        <p className="text-xs text-slate-400 mt-0.5">{client.industry}</p>
      )}
      {sovScore !== undefined && (
        <p className="text-2xl font-black text-blue-600 mt-3">
          {sovScore}%
          <span className="text-xs font-normal text-slate-400 ml-1">SoV</span>
        </p>
      )}
    </Link>
  )
}
