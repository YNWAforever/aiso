import { LoginForm } from '@/components/auth/LoginForm'
import { Zap } from 'lucide-react'

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ next?: string }>
}) {
  const { lang } = await params
  const { next } = await searchParams
  const signInText = lang === 'zh-HK' ? '登入你的儀表板' : 'Sign in to your dashboard'

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border p-8 w-full max-w-sm shadow-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <Zap className="size-4 text-primary" />
            <p className="font-black text-foreground text-xl">
              Fimmick <span className="text-primary">AEO</span>
            </p>
          </div>
          <p className="text-muted-foreground text-sm">{signInText}</p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  )
}
