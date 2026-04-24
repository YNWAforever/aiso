import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { ProfileWithAccount } from '@/lib/types'

export async function getProfile(): Promise<ProfileWithAccount | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*, accounts(*)')
    .eq('id', user.id)
    .single()

  if (!data) return null
  // Attach the auth email so callers (e.g. Stripe checkout) can use it
  return { ...data, email: user.email ?? null } as ProfileWithAccount | null
}

export async function requireAuth(lang = 'en'): Promise<ProfileWithAccount> {
  const profile = await getProfile()
  if (!profile) redirect(`/${lang}/auth/login`)
  return profile
}

export async function requireAdmin(lang = 'en'): Promise<ProfileWithAccount> {
  const profile = await requireAuth(lang)
  if (!profile.is_admin) redirect(`/${lang}/dashboard`)
  return profile
}
