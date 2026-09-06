/**
 * The public information architecture, declared once.
 *
 * Phase 2 adds roughly seventeen pages. Adding nav entries slice by slice would
 * mean designing the dropdown structure for nine platform pages in the slice
 * that builds them, with everything else already depending on the header's
 * shape. Declaring the whole IA now costs one file and settles it while it is
 * still cheap to change.
 *
 * Only routes that exist today are `available`. `__tests__/lib/navigation.test.ts`
 * resolves every available href to a real page file, so the flag polices itself
 * rather than relying on someone remembering — an entry flipped on too early
 * would put a 404 in the header of every page on the site. The same test asserts
 * the reverse: a route in the frozen contract with no entry here fails, because
 * that is a page no visitor could reach from the chrome.
 *
 * Hrefs come from `docs/contracts/routes.md`, which is frozen and authoritative.
 * They are locale-relative: the header prefixes the active locale.
 */

export type NavSection = 'top' | 'platform' | 'solutions' | 'company'

export type NavEntry = {
  section: NavSection
  /** Dotted key into messages/*.json. Never a literal string. */
  labelKey: string
  /** Locale-relative path, e.g. '/pricing'. '/' is the home page. */
  href: string
  /**
   * Render only when true. Flipping this on before the page exists fails
   * __tests__/lib/navigation.test.ts.
   */
  available: boolean
}

export const NAV: NavEntry[] = [
  // Top level — the two that exist today, plus the public entry points.
  { section: 'top', labelKey: 'nav.home', href: '/', available: true },
  { section: 'top', labelKey: 'nav.pricing', href: '/pricing', available: true },
  { section: 'top', labelKey: 'nav.scan', href: '/scan', available: false },
  { section: 'top', labelKey: 'nav.demo', href: '/demo', available: false },
  { section: 'top', labelKey: 'nav.sample_report', href: '/sample-report', available: false },

  // Platform — nine pages: the overview plus eight capabilities.
  { section: 'platform', labelKey: 'nav.platform.overview', href: '/platform', available: true },
  { section: 'platform', labelKey: 'nav.platform.search_intelligence', href: '/platform/search-intelligence', available: true },
  { section: 'platform', labelKey: 'nav.platform.site_health', href: '/platform/site-health', available: true },
  { section: 'platform', labelKey: 'nav.platform.demand_intelligence', href: '/platform/demand-intelligence', available: true },
  { section: 'platform', labelKey: 'nav.platform.brand_product_discovery', href: '/platform/brand-product-discovery', available: true },
  { section: 'platform', labelKey: 'nav.platform.ai_visibility', href: '/platform/ai-visibility', available: true },
  { section: 'platform', labelKey: 'nav.platform.action_studio', href: '/platform/action-studio', available: true },
  { section: 'platform', labelKey: 'nav.platform.governed_agents', href: '/platform/governed-agents', available: true },
  { section: 'platform', labelKey: 'nav.platform.proof', href: '/platform/proof', available: true },

  // Solutions — an index plus four audiences.
  { section: 'solutions', labelKey: 'nav.solutions.overview', href: '/solutions', available: true },
  { section: 'solutions', labelKey: 'nav.solutions.sme', href: '/solutions/sme', available: true },
  { section: 'solutions', labelKey: 'nav.solutions.agencies', href: '/solutions/agencies', available: true },
  { section: 'solutions', labelKey: 'nav.solutions.enterprise', href: '/solutions/enterprise', available: true },
  { section: 'solutions', labelKey: 'nav.solutions.regulated_industries', href: '/solutions/regulated-industries', available: true },

  // Company, trust and legal.
  { section: 'company', labelKey: 'nav.company.how_it_works', href: '/how-it-works', available: true },
  { section: 'company', labelKey: 'nav.company.methodology', href: '/methodology', available: false },
  { section: 'company', labelKey: 'nav.company.integrations', href: '/integrations', available: true },
  { section: 'company', labelKey: 'nav.company.discover', href: '/discover', available: false },
  { section: 'company', labelKey: 'nav.company.resources', href: '/resources', available: true },
  { section: 'company', labelKey: 'nav.company.security', href: '/security', available: true },
  { section: 'company', labelKey: 'nav.company.trust', href: '/trust', available: true },
  { section: 'company', labelKey: 'nav.company.privacy', href: '/privacy', available: false },
  { section: 'company', labelKey: 'nav.company.terms', href: '/terms', available: false },
  { section: 'company', labelKey: 'nav.company.contact', href: '/contact', available: true },
]
