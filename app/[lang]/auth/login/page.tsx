import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm shadow-sm">
        <div className="text-center mb-8">
          <p className="font-black text-slate-900 text-xl">
            Fimmick <span className="text-blue-600">AEO</span>
          </p>
          <p className="text-slate-500 text-sm mt-1">Sign in to your dashboard</p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  )
}
