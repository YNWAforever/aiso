import { createClient } from '@supabase/supabase-js'

type SupabaseClient = ReturnType<typeof createClient>

// Lazy singleton — createClient is deferred until first use so that
// module evaluation at Next.js build time (when env vars may be absent)
// does not throw "supabaseUrl is required".
let _instance: SupabaseClient | null = null

function getInstance(): SupabaseClient {
  if (!_instance) {
    _instance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return _instance
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return (getInstance() as Record<string | symbol, unknown>)[prop]
  },
})
