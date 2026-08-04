import { featureUnavailable } from '@/lib/unavailable'

// Fenced during the Supabase to Neon migration. This route is auth-gated but
// transitively dead: it reaches the deleted Supabase host through
// lib/localTrust/store.ts. The Supabase implementation is in git history at
// the parent of this commit. Restoring it means porting the queries to
// db(), not reviving code that targets a deleted project.
export async function PUT() {
  return featureUnavailable('local-trust')
}
