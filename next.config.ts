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
      // Redirect bare (non-lang) legacy URLs to the English equivalents
      { source: '/pricing',    destination: '/en/pricing',    permanent: true },
      { source: '/auth/login', destination: '/en/auth/login', permanent: true },
    ]
  },
}

export default withNextIntl(nextConfig)
