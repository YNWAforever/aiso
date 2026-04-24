import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Redirect bare (non-lang) legacy URLs to the English equivalents
      { source: '/pricing',    destination: '/en/pricing',    permanent: true },
      { source: '/auth/login', destination: '/en/auth/login', permanent: true },
    ]
  },
}

export default withNextIntl(nextConfig)
