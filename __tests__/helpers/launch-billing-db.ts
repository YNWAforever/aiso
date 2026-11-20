import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

type QueryExecutor = Pick<PGlite, 'query'>

export async function createLaunchBillingDb() {
  const pg = new PGlite()
  await pg.exec(`
    create role aeo_app bypassrls;
    create schema neon_auth;
    create table neon_auth."user" (id uuid primary key, email text);
    create table accounts (
      id uuid primary key, plan text default 'basic', status text default 'active',
      stripe_customer_id text unique, stripe_subscription_id text,
      trial_started_at timestamptz, trial_ends_at timestamptz, trial_emails_sent integer default 0,
      override_plan text, override_expires_at timestamptz
    );
    create table profiles (id uuid primary key, account_id uuid references accounts, created_at timestamptz default now(), deactivated_at timestamptz);
    create table clients (id uuid primary key, account_id uuid references accounts, unique (id, account_id));
    create table scans (id uuid primary key, account_id uuid references accounts, client_id uuid references clients);
    create table fix_packs (id uuid primary key default gen_random_uuid(), scan_id uuid references scans, llms_txt text, robots_patch text, faq_schema text, created_at timestamptz default now());
    grant select, insert, update, delete on all tables in schema public to aeo_app;
    grant usage on schema neon_auth to aeo_app;
    grant select on neon_auth."user" to aeo_app;
  `)
  for (const migration of [
    '024_stripe_lifecycle_integrity.sql', '107_per_fix_billing.sql', '110_recoverable_stripe_billing.sql',
    '111_trial_email_delivery.sql', '112_verified_signup.sql',
  ]) {
    await pg.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'))
  }
  await pg.exec('grant select, insert, update, delete on stripe_webhook_events, stripe_subscription_processing_leases to aeo_app; grant execute on all functions in schema public to aeo_app')

  const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, index) => `${text}${index ? `$${index}` : ''}${part}`, '')
    const execute = async (connection: QueryExecutor) => (await connection.query(query, values)).rows
    return Object.assign({ execute }, { then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => execute(pg).then(resolve, reject) })
  }, {
    async transaction(queries: Array<{ execute: (connection: QueryExecutor) => Promise<unknown[]> }>) {
      return pg.transaction(async connection => {
        const results = []
        for (const query of queries) results.push(await query.execute(connection))
        return results
      })
    },
  })
  return { pg, sql }
}
