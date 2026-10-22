'use client'

import { useEffect } from 'react'
import { routing } from '@/i18n/routing'

export function DocumentLanguage({ locale }: { locale: string }) {
  useEffect(() => {
    // The root layout supplies SSR lang but persists across client navigation.
    // The active localized layout keeps assistive technology on its language.
    if ((routing.locales as readonly string[]).includes(locale)) {
      document.documentElement.lang = locale
    }
  }, [locale])

  return null
}
