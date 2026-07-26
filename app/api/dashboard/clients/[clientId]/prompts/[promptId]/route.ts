import { featureUnavailable } from '@/lib/unavailable'

// Fenced during the Supabase to Neon migration. The Supabase implementation is
// in git history at the parent of this commit. Restoring it means porting the
// queries to db(), not reviving code that targets a deleted project.
export async function PATCH() {
  return featureUnavailable('prompt-bank')
}

export async function DELETE() {
  return featureUnavailable('prompt-bank')
}
