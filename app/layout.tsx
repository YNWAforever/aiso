import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fimmick AEO — AI Search Readiness Check',
  description: 'Check if your website is visible to AI search engines. Free Fix Pack included.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
