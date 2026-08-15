#!/usr/bin/env node
// Prove DATABASE_URL connects, and report which database answered.
// Safe to run with the output pasted into a ticket: no DSN, no password.
//
//   node --env-file=.env.local scripts/verify-db-connection.mjs
import { neon } from '@neondatabase/serverless'

// @ts-expect-error -- node needs the explicit .ts extension for this relative
// import; tsc forbids it under moduleResolution "bundler" without repo-wide
// allowImportingTsExtensions, which would loosen next build's check elsewhere.
import { redactSecrets } from '../lib/security/redact-secrets.ts'

const dsn = process.env.DATABASE_URL
if (!dsn) {
  console.error('DATABASE_URL is not set. Pass --env-file=.env.local, or export it.')
  process.exit(1)
}

let url
try {
  url = new URL(dsn)
} catch {
  console.error('DATABASE_URL is not a valid URL.')
  process.exit(1)
}

console.log('host    :', url.hostname)
console.log('database:', url.pathname.replace(/^\//, ''))
console.log('role    :', url.username)

try {
  const sql = neon(dsn)
  const [row] = await sql`
    select
      current_user                                    as role,
      current_database()                              as db,
      (select count(*) from public.schema_migrations) as migrations,
      (select count(*) from public.accounts)          as accounts,
      (select count(*) from public.clients)           as clients`
  console.log('connected: yes')
  console.log('server   :', { role: row.role, db: row.db })
  console.log('schema   :', {
    migrations: row.migrations,
    accounts: row.accounts,
    clients: row.clients,
  })
  process.exit(0)
} catch (error) {
  console.error('connected: NO')
  console.error(redactSecrets(String(error?.message ?? error)))
  process.exit(1)
}
