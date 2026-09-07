import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { PUBLIC_REPORT_SECURITY_HEADER_VALUES } from './lib/reports/public-security'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  // Keep Turbopack inside this checkout when a parent directory contains an
  // unrelated lockfile (common on local Windows workspaces and worktrees).
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: '/:lang(en|zh-HK)/r/:slug',
        headers: Object.entries(PUBLIC_REPORT_SECURITY_HEADER_VALUES).map(([key, value]) => ({
          key,
          value,
        })),
      },
    ]
  },
  async redirects() {
    return [
      { source: '/r/demo', destination: '/en/sample-report', permanent: false },
      { source: '/:lang(en|zh-HK)/r/demo', destination: '/:lang/sample-report', permanent: false },
      // Redirect bare (non-lang) legacy URLs to the English equivalents
      { source: '/pricing',    destination: '/en/pricing',    permanent: true },
      { source: '/auth/login', destination: '/en/auth/login', permanent: true },
      { source: '/how-it-works', destination: '/en/how-it-works', permanent: true },
      // Frozen public capability aliases; locale prefixes are explicit because
      // next-intl routing is handled by proxy.ts, after config redirects.
      ...[
        ['/platform/search-visibility', '/platform/search-intelligence'],
        ['/foundation', '/platform/site-health'],
        ['/answer-readiness', '/platform/demand-intelligence'],
        ['/citation-readiness', '/platform/ai-visibility'],
        ['/ai-pulse', '/platform/ai-visibility'],
      ].flatMap(([source, destination]) => [
        { source, destination: `/en${destination}`, permanent: true },
        {
          source: `/:lang(en|zh-HK)${source}`,
          destination: `/:lang${destination}`,
          permanent: true,
        },
      ]),
    ]
  },
}

export default withNextIntl(nextConfig)
