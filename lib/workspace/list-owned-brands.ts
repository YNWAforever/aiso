import 'server-only'
import { db } from '@/lib/db'

export interface OwnedBrand { id: string; name: string; domain: string | null }

/**
 * The account's active brands for the dashboard's brand switcher and ⌘K. A
 * light read (three columns), unlike loadOwnedPortfolio, because it runs on
 * every dashboard page. Throws on a database failure; the layout shows the
 * switcher without a list rather than an empty one.
 */
export async function listOwnedBrands(accountId: string): Promise<OwnedBrand[]> {
  const rows = await db()`
    select id, brand_name, domain from clients
    where account_id = ${accountId} and status = 'active'
    order by created_at, id
  `
  return rows.map(row => ({ id: String(row.id), name: String(row.brand_name ?? row.domain ?? ''), domain: typeof row.domain === 'string' ? row.domain : null }))
}
