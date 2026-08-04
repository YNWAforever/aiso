import { featureUnavailable } from '@/lib/unavailable'

export const dynamic = 'force-dynamic'

// Fenced during the Supabase to Neon migration. The Supabase implementation is
// in git history at the parent of this commit. Restoring it means porting the
// queries to db(), not reviving code that targets a deleted project.
export async function GET() {
  return featureUnavailable('trial-emails')
}
