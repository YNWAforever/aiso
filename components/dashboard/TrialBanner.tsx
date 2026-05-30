// components/dashboard/TrialBanner.tsx
import Link from 'next/link'
import { Zap, Clock } from 'lucide-react'

interface Props {
  daysRemaining: number
  lang: string
}

export function TrialBanner({ daysRemaining, lang }: Props) {
  const urgent = daysRemaining <= 2
  return (
    <div className={`flex items-center justify-between px-6 py-2.5 text-sm font-medium ${urgent ? 'bg-red-600 text-white' : 'bg-primary text-primary-foreground'}`}>
      <div className="flex items-center gap-2">
        {urgent ? <Clock className="size-3.5" /> : <Zap className="size-3.5" />}
        <span>
          {daysRemaining > 0
            ? `🎁 Free trial · ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`
            : '⚠️ Your trial ends today'}
        </span>
      </div>
      <Link
        href={`/${lang}/pricing`}
        className={`text-xs font-bold underline underline-offset-2 hover:no-underline transition ${urgent ? 'text-white' : 'text-primary-foreground'}`}
      >
        Upgrade now →
      </Link>
    </div>
  )
}
