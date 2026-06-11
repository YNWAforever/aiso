// components/dashboard/TrialBanner.tsx
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Zap, Clock } from 'lucide-react'

interface Props {
  daysRemaining: number
  lang: string
}

export function TrialBanner({ daysRemaining, lang }: Props) {
  const t = useTranslations('dashboard')
  const urgent = daysRemaining <= 2
  return (
    <div className={`flex items-center justify-between px-6 py-2.5 text-sm font-medium ${urgent ? 'bg-red-600 text-white' : 'bg-primary text-primary-foreground'}`}>
      <div className="flex items-center gap-2">
        {urgent ? <Clock className="size-3.5" /> : <Zap className="size-3.5" />}
        <span>
          {daysRemaining > 0
            ? t('trial_remaining', { days: daysRemaining })
            : t('trial_ends_today')}
        </span>
      </div>
      <Link
        href={`/${lang}/pricing`}
        className={`text-xs font-bold underline underline-offset-2 hover:no-underline transition ${urgent ? 'text-white' : 'text-primary-foreground'}`}
      >
        {t('upgrade_now')}
      </Link>
    </div>
  )
}
