'use client'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { Zap, BarChart2, ShieldCheck, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'

const FEATURES = [
  {
    icon: BarChart2,
    title: 'Share of Voice Tracking',
    body:  'See how often your brand appears in AI-generated answers across ChatGPT, Perplexity, Claude, and Gemini.',
  },
  {
    icon: Globe,
    title: 'Multi-Platform Coverage',
    body:  'Track all major AI search engines weekly — automatically. No manual queries needed.',
  },
  {
    icon: ShieldCheck,
    title: 'Competitor Benchmarking',
    body:  'Know exactly where your competitors rank in AI results and spot opportunities to close the gap.',
  },
]

export default function HomePage() {
  const t      = useTranslations()
  const router = useRouter()
  const params = useParams<{ lang: string }>()
  const [url, setUrl]         = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      router.push(`/${params.lang}/result/${data.id}`)
    } catch {
      setError('Could not scan this URL. Please check it and try again.')
      setLoading(false)
    }
  }

  const otherLang  = params.lang === 'en' ? 'zh-HK' : 'en'
  const otherLabel = params.lang === 'en' ? '中文' : 'EN'

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="bg-card border-b px-6 py-3.5 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <span className="font-black text-foreground text-sm">
            Fimmick <span className="text-primary">AEO</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${params.lang}/auth/login`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('nav.sign_in')}
          </Link>
          <Button size="sm" asChild>
            <Link href={`/${params.lang}/pricing`}>{t('nav.get_started')}</Link>
          </Button>
          <Link href={`/${otherLang}`} className="text-sm text-primary hover:underline">
            {otherLabel}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main>
        <section className="max-w-2xl mx-auto px-6 py-24 text-center">
          <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold tracking-widest px-4 py-1.5 rounded-full mb-6">
            <Zap className="size-3" />
            {t('home.badge')}
          </span>
          <h1 className="text-5xl font-black text-foreground leading-[1.1] mb-4 whitespace-pre-line">
            {t('home.headline')}
          </h1>
          <p className="text-muted-foreground text-lg mb-10">{t('home.subheadline')}</p>

          <form onSubmit={handleScan} className="flex gap-2 max-w-lg mx-auto">
            <Input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('home.placeholder')}
              className="flex-1 h-10 border-2 border-primary/60 focus-visible:ring-primary/30"
              required
            />
            <Button type="submit" disabled={loading} className="px-6">
              {loading ? '…' : t('home.cta')}
            </Button>
          </form>

          {error && <p className="text-destructive text-sm mt-3">{error}</p>}
          <p className="text-xs text-muted-foreground mt-6">{t('home.trust')}</p>
        </section>

        {/* Feature grid */}
        <section className="max-w-4xl mx-auto px-6 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-card rounded-xl border p-6 space-y-3">
                <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon className="size-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground text-sm">{title}</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
