This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Public scan deployment prerequisites

Production anonymous scans are supported only on Vercel, where the platform overwrites
`x-vercel-forwarded-for` and exposes the `VERCEL=1` system environment invariant.
The endpoint fails closed when either invariant is missing.

Before releasing public scans:

- Apply `supabase/migrations/023_public_scan_rate_limits.sql` to the production database.
- Apply `supabase/migrations/024_stripe_lifecycle_integrity.sql` before enabling Stripe webhooks.
- Apply `supabase/migrations/025_authenticated_scan_quotas.sql` before releasing authenticated scans.
  The server-only `DATABASE_URL` role must be able to insert, update, select, and delete rows in
  `authenticated_scan_monthly_usage`; authenticated scans fail closed if the counter is unavailable.
- Apply `supabase/migrations/026_effective_brand_limit.sql` before releasing self-service brand creation.
  It replaces the legacy raw-plan trigger with serialized, effective-entitlement enforcement.
- Configure the server-only `PUBLIC_SCAN_RATE_LIMIT_SECRET` with at least 32 random characters.
  Do not expose it through a `NEXT_PUBLIC_` variable or commit its value.

Local development and tests use a single explicitly isolated identity and development-only
HMAC key. They ignore forwarding headers and do not claim production proxy security.
