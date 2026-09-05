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
    <>
      <a href="#main-content" className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {lang === 'zh-HK' ? '跳至主要內容' : 'Skip to main content'}
      </a>
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border p-8 w-full max-w-sm shadow-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <Zap className="size-4 text-primary" />
            <p className="font-black text-foreground text-xl">
              Fimmick <span className="text-primary">AEO</span>
            </p>
          </div>
          <h1 className="text-muted-foreground text-sm">{signInText}</h1>
        </div>
        <LoginForm next={next} />
      </div>
      </main>
    </>
  )
}
