import { SessionRefresh } from '@/components/auth/SessionRefresh'
import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin() // Redirects non-admins to /en/dashboard
  return (
    <div className="min-h-screen bg-slate-50">
      <SessionRefresh />
      <nav className="bg-slate-900 px-6 py-3 flex items-center gap-4">
        <span className="font-black text-white text-sm">
          <Link href="/admin">Fimmick <span className="text-blue-400">AISO</span>{' '}
          <span className="text-slate-400 font-normal">Super Admin</span></Link>
        </span>
        <Link href="/en/dashboard" className="text-xs text-slate-400 hover:text-white ml-auto">
          ← Back to Dashboard
        </Link>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
