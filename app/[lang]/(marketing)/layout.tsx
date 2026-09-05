import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SiteHeader } from '@/components/marketing/SiteHeader'

/**
 * The shell every public page renders inside.
 *
 * The landmarks are the load-bearing part, not the chrome. `<main id="main">`
 * wraps *all* page content, which is what `landmark-one-main` and `region`
 * check for — the pricing page previously nested its own footer inside its
 * `<main>`, and neither page agreed with the other about where `<header>`
 * began. Pages below this layout must not render their own `<main>`,
 * `<header>` or `<footer>`.
 *
 * `flex-1` makes the footer sit at the bottom of short pages: the root
 * `<body>` is `min-h-full flex flex-col`.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
