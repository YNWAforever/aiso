// Re-export the middleware function and config from proxy.ts.
// next-intl v4 with createNextIntlPlugin() does locale routing at the
// framework level when no middleware.ts exists. By providing middleware
// here, we take control and can exclude /auth/callback from locale routing.
export { proxy as middleware, config } from './proxy'
