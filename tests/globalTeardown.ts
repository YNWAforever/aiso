/**
 * Playwright globalTeardown — removes the seeded test scan after all tests.
 */
import fs from 'fs'
import path from 'path'
import { TEST_SCAN_ID } from './constants'

export default async function globalTeardown() {
  const envPath = path.join(process.cwd(), '.env.local')
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if ((!serviceKey || !supabaseUrl) && fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8')
    for (const line of env.split('\n')) {
      const eqIdx = line.indexOf('=')
      if (eqIdx < 0) continue
      const key = line.slice(0, eqIdx).trim()
      const val = line.slice(eqIdx + 1).trim()
      if (key === 'SUPABASE_SERVICE_ROLE_KEY' && !serviceKey) serviceKey = val
      if (key === 'NEXT_PUBLIC_SUPABASE_URL'  && !supabaseUrl) supabaseUrl = val
    }
  }

  if (!serviceKey || !supabaseUrl) return

  await fetch(`${supabaseUrl}/rest/v1/scans?id=eq.${TEST_SCAN_ID}`, {
    method: 'DELETE',
    headers: {
      apikey:        serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
  console.log(`[globalTeardown] Test scan deleted — ID: ${TEST_SCAN_ID}`)
}
