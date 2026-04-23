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

  return data as ProfileWithAccount | null
}

export async function requireAuth(): Promise<ProfileWithAccount> {
  const profile = await getProfile()
  if (!profile) redirect('/auth/login')
  return profile
}

export async function requireAdmin(): Promise<ProfileWithAccount> {
  const profile = await requireAuth()
  if (!profile.is_admin) redirect('/en/dashboard')
  return profile
}
