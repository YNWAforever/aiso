import { createClient } from '@supabase/supabase-js'
import { INDUSTRY_PACKS, REGIONAL_PACKS } from '../lib/authority/packs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function seed() {
  console.log('Seeding industry packs...')
  for (const pack of Object.values(INDUSTRY_PACKS)) {
    const { error } = await supabase.from('industry_packs').upsert({
      code:              pack.code,
      display_name:      pack.displayName,
      multiplier:        pack.multiplier,
      authority_domains: pack.authorityDomains,
      topical_keywords:  pack.topicalKeywords,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'code' })
    if (error) console.error(`industry_packs error (${pack.code}):`, error.message)
    else console.log(`  ✓ ${pack.code}`)
  }

  console.log('Seeding regional packs...')
  for (const pack of Object.values(REGIONAL_PACKS)) {
    const { error } = await supabase.from('regional_packs').upsert({
      code:         pack.code,
      display_name: pack.displayName,
      tiers: {
        tier1: pack.tier1Local,
        tier2: pack.tier2Local,
        tier3: pack.tier3Local,
        community: pack.community,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'code' })
    if (error) console.error(`regional_packs error (${pack.code}):`, error.message)
    else console.log(`  ✓ ${pack.code}`)
  }
  console.log('Done.')
}

seed().catch(console.error)
