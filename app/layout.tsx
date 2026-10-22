import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { getLocale, getTranslations } from 'next-intl/server'
import { SITE_URL } from '@/lib/seo'
import './globals.css'

// Inter for Latin text only. `optional` so it can never delay LCP: a first
// visit on a slow connection paints with the size-adjusted fallback and later
// visits use the cached font.
//
// Traditional Chinese deliberately uses system fonts (see --font-sans). A CJK
// webfont was tried: Noto Sans TC cost 18 files / 1.1 MB on the zh-HK home
// page and pushed mobile LCP from 2.6 s to 9.9 s (Lighthouse 94 -> 57), while
// every platform already ships a good TC face.
const inter = Inter({ subsets: ['latin'], display: 'optional', variable: '--font-inter' })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: await getLocale(), namespace: 'seo.root' })
  return { metadataBase: SITE_URL, title: t('title'), description: t('description') }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale} className={`h-full antialiased ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var theme = localStorage.getItem('theme');
            if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
              document.documentElement.classList.add('dark');
            }
          })();
        `}} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
