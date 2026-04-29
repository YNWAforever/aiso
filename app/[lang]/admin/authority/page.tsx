import { createServerSupabaseClient } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default async function AdminAuthorityPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${lang}/auth/login`)
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect(`/${lang}/dashboard`)

  const { data: overrides } = await supabase
    .from('authority_overrides')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-6">Authority Engine — Manual Overrides</h1>
      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {['Domain','Override Tier','Score','Client','Reason','Created'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {(overrides ?? []).map((o: Record<string, unknown>) => (
              <tr key={o.id as string} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs">{o.domain as string}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    o.override_tier === 'tier1' ? 'bg-green-100 text-green-800' :
                    o.override_tier === 'blacklist' ? 'bg-red-100 text-red-800' :
                    'bg-secondary text-secondary-foreground'
                  }`}>{o.override_tier as string}</span>
                </td>
                <td className="px-4 py-3">{(o.override_score as string) ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{(o.client_id as string)?.slice(0, 8) ?? 'Global'}</td>
                <td className="px-4 py-3 text-muted-foreground">{(o.reason as string) ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(o.created_at as string).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
