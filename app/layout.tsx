import type { Metadata } from 'next'
import { Inter, Noto_Sans_TC } from 'next/font/google'
import { getLocale, getTranslations } from 'next-intl/server'
import { SITE_URL } from '@/lib/seo'
import './globals.css'

// Both are variable fonts, so no weight list. Inter preloads its Latin subset
// (it renders the LCP text on every English page). Noto Sans TC does not
// preload: Google serves it as ~100 unicode-range slices, and the browser
// fetches only the slices a page actually uses.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })
const notoTc = Noto_Sans_TC({ subsets: ['latin'], display: 'swap', variable: '--font-noto-tc', preload: false })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: await getLocale(), namespace: 'seo.root' })
  return { metadataBase: SITE_URL, title: t('title'), description: t('description') }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale} className={`h-full antialiased ${inter.variable} ${notoTc.variable}`} suppressHydrationWarning>
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
