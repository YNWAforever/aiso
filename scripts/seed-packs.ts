import { db } from '@/lib/db'
import { INDUSTRY_PACKS, REGIONAL_PACKS } from '../lib/authority/packs'
// node needs the explicit .ts extension to resolve this relative import when
// running this file directly (plain node, no bundler); tsc rejects that
// extension under moduleResolution "bundler" without repo-wide
// allowImportingTsExtensions, which would also loosen next build's check on
// app/, lib/ and components/. Suppress narrowly instead of widening globally.
// @ts-expect-error -- see comment above; node requires the extension, tsc forbids it
import { redactSecrets } from '../lib/security/redact-secrets.ts'

async function seed() {
  const sql = db()

  console.log('Seeding industry packs...')
  for (const pack of Object.values(INDUSTRY_PACKS)) {
    await sql`
      insert into industry_packs (code, display_name, multiplier, authority_domains, topical_keywords, updated_at)
      values (
        ${pack.code}, ${pack.displayName}, ${pack.multiplier},
        ${JSON.stringify(pack.authorityDomains)}::jsonb,
        ${pack.topicalKeywords},
        now()
      )
      on conflict (code) do update set
        display_name      = excluded.display_name,
        multiplier        = excluded.multiplier,
        authority_domains = excluded.authority_domains,
        topical_keywords  = excluded.topical_keywords,
        updated_at        = now()
    `
    console.log(`  ✓ ${pack.code}`)
  }

  console.log('Seeding regional packs...')
  for (const pack of Object.values(REGIONAL_PACKS)) {
    await sql`
      insert into regional_packs (code, display_name, tiers, updated_at)
      values (
        ${pack.code}, ${pack.displayName},
        ${JSON.stringify({
          tier1: pack.tier1Local,
          tier2: pack.tier2Local,
          tier3: pack.tier3Local,
          community: pack.community,
        })}::jsonb,
        now()
      )
      on conflict (code) do update set
        display_name = excluded.display_name,
        tiers        = excluded.tiers,
        updated_at   = now()
    `
    console.log(`  ✓ ${pack.code}`)
  }
  console.log('Done.')
}

seed().catch((err) => {
  console.error(redactSecrets(String(err.message)))
  process.exit(1)
})
