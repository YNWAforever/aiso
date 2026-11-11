import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/107_per_fix_billing.sql', 'utf8')

describe('per-fix billing schema (107)', () => {
  it('creates the three billing tables', () => {
    for (const table of ['account_billing', 'fix_billing_events', 'billing_invoices']) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table} \\(`, 'i'))
    }
  })

  it('lets the admin control billing mode but never lets a metered row bill nothing', () => {
    expect(sql).toMatch(/mode text not null default 'included'/i)
    expect(sql).toMatch(/check \(mode in \('included', 'metered'\)\)/i)
    expect(sql).toMatch(/check \(mode <> 'metered'\s+or \(stripe_metered_item_id is not null and stripe_subscription_id is not null\)\)/i)
    expect(sql).toMatch(/opened_by uuid not null/i)
  })

  it('records one billable fix pack at most once, with a stable Stripe identifier', () => {
    // unique(fix_pack_id) is the double-billing guard; the identifier is minted
    // at insert time so a retry does not depend on the pack row still existing.
    expect(sql).toMatch(/fix_pack_id uuid unique references public\.fix_packs\(id\) on delete set null/i)
    expect(sql).toMatch(/stripe_meter_event_identifier text not null/i)
    expect(sql).toMatch(/stripe_meter_event_identifier ~ '\^fixbilling:/i)
    expect(sql).toMatch(/state in \('pending', 'reported', 'failed', 'void'\)/i)
    expect(sql).toMatch(/state <> 'reported' or reported_at is not null/i)
    expect(sql).toMatch(/attempts between 0 and 10/i)
    expect(sql).toMatch(/last_error_code ~ '\^\[A-Z\]\[A-Z0-9_\]\{2,40\}\$'/i)
    expect(sql).toMatch(/quantity = 1/i)
  })

  it('scopes fix billing rows to their brand with a composite tenant FK', () => {
    expect(sql).toMatch(/foreign key \(client_id, account_id\)\s+references public\.clients \(id, account_id\)\s+on delete restrict/i)
    expect(sql).toMatch(/create index if not exists fix_billing_events_scope_time_idx\s+on public\.fix_billing_events \(account_id, client_id, created_at desc\)/i)
    // Only rows that still need attention are indexed for the admin retry queue.
    expect(sql).toMatch(/where state <> 'reported'/i)
  })

  it('mirrors admin-issued one-off invoices with a closed vocabulary', () => {
    expect(sql).toMatch(/stripe_invoice_id text unique/i)
    expect(sql).toMatch(/currency in \('usd', 'hkd'\)/i)
    expect(sql).toMatch(/status in \('draft', 'open', 'paid', 'void', 'uncollectible'\)/i)
    expect(sql).toMatch(/amount_cents > 0/i)
    expect(sql).toMatch(/char_length\(btrim\(description\)\) between 3 and 500/i)
    expect(sql).toMatch(/hosted_invoice_url ~ '\^https:\/\//i)
    expect(sql).toMatch(/created_by uuid not null/i)
  })

  it('enables RLS with app grants only and no policies', () => {
    for (const table of ['account_billing', 'fix_billing_events', 'billing_invoices']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${table} from public`, 'i'))
      expect(sql).toMatch(new RegExp(`grant select, insert, update on public\\.${table} to aeo_app`, 'i'))
    }
    expect(sql).not.toMatch(/create policy|create trigger|grant [^;]*\bdelete\b|pg_cron/i)
  })

  it('guards the Supabase-era roles behind to_regrole', () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(sql).toMatch(new RegExp(`to_regrole\\('${role}'\\) is not null`, 'i'))
    }
  })
})
