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

// Exported as `any` because without generated Supabase schema types,
// the typed SupabaseClient makes all .insert() / .upsert() row types `never`.
// Using `any` lets callers access all Supabase methods without spurious TS errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getInstance() as any)[prop]
  },
})
