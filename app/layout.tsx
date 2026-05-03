import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fimmick AEO — AI Search Readiness Check',
  description: 'Check if your website is visible to AI search engines. Free Fix Pack included.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="h-full antialiased" suppressHydrationWarning>
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
