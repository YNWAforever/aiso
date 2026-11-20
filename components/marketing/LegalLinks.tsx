'use client'

import { useLocale, useTranslations } from 'next-intl'

function publicHttpsUrl(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function LegalLinks({ className = '' }: { className?: string }) {
  const chinese = useLocale() === 'zh-HK'
  const t = useTranslations('nav.company')
  const privacy = publicHttpsUrl(chinese ? process.env.NEXT_PUBLIC_AISO_PRIVACY_ZH_HK_URL : process.env.NEXT_PUBLIC_AISO_PRIVACY_EN_URL)
  const terms = publicHttpsUrl(chinese ? process.env.NEXT_PUBLIC_AISO_TERMS_ZH_HK_URL : process.env.NEXT_PUBLIC_AISO_TERMS_EN_URL)
  if (!privacy && !terms) return null
  return <div className={`flex flex-wrap gap-x-4 text-sm text-muted-foreground ${className}`}>
    {privacy && <a href={privacy} className="inline-flex min-h-11 items-center underline underline-offset-4">{t('privacy')}</a>}
    {terms && <a href={terms} className="inline-flex min-h-11 items-center underline underline-offset-4">{t('terms')}</a>}
  </div>
}
