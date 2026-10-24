import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { buildOrganizationJsonLd } from '@/lib/seo'

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
 *
 * Every public page names the company behind the product (Organization
 * JSON-LD), which is what entity checks such as our own c15 look for.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildOrganizationJsonLd()).replace(/</g, '\\u003c') }}
      />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
