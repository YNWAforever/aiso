'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Zap, Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge }             from '@/components/ui/badge'
import { Button }            from '@/components/ui/button'
import { cn }                from '@/lib/utils'

export default function PricingPage() {
  const [loading, setLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const { lang } = useParams<{ lang: string }>()

  const startProCheckout = async () => {
    setLoading(true)
    setCheckoutError('')
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro' }),
      })
      if (res.status === 401) {
        window.location.href = `/${lang}/auth/login?next=/${lang}/pricing`
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setCheckoutError(data.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      if (data.url) window.location.href = data.url
    } catch {
      setCheckoutError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card border-b px-6 py-3.5 flex justify-between items-center">
        <Link href={`/${lang}`} className="flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <span className="font-black text-foreground text-sm">
            Fimmick <span className="text-primary">AEO</span>
          </span>
        </Link>
        <Link href={`/${lang}/auth/login`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Sign in
        </Link>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black text-foreground">
            Know where your brand stands in AI search
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Track your Share of Voice across ChatGPT, Perplexity, Claude, and Gemini — every week, automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Starter */}
          <Card>
            <CardContent className="p-7">
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">Starter</p>
              <p className="text-3xl font-black text-foreground mt-2">Free</p>
              <p className="text-xs text-muted-foreground mt-1">No credit card needed</p>
              <ul className="mt-6 space-y-2 text-sm text-foreground">
                {['3 AEO scans / month', 'AI Fix Pack', '1 brand', '4-week Pulse history'].map(f => (
                  <li key={f} className="flex gap-2 items-center">
                    <Check className="size-3.5 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
                {['Prompt editing', 'Alerts'].map(f => (
                  <li key={f} className="flex gap-2 items-center text-muted-foreground/50">
                    <span className="size-3.5 flex-shrink-0 text-center">–</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button variant="secondary" className="mt-8 w-full" asChild>
                <Link href={`/${lang}/auth/login`}>Get Started Free</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Pro */}
          <Card className={cn('border-primary relative')}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="text-xs px-3 py-1">MOST POPULAR</Badge>
            </div>
            <CardContent className="p-7">
              <p className="text-xs font-bold tracking-widest text-primary uppercase">Pro</p>
              <p className="text-3xl font-black text-foreground mt-2">
                $99<span className="text-base font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">Billed monthly</p>
              <ul className="mt-6 space-y-2 text-sm text-foreground">
                {['Unlimited AEO scans', 'AI Fix Pack', '1 brand', '6-month history', 'Edit prompt bank', 'SoV alerts', 'Competitor benchmarking'].map(f => (
                  <li key={f} className="flex gap-2 items-center">
                    <Check className="size-3.5 text-primary flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button onClick={startProCheckout} disabled={loading} className="mt-8 w-full">
                {loading ? 'Loading…' : 'Start Pro →'}
              </Button>
              {checkoutError && (
                <p className="mt-3 text-destructive text-xs text-center">{checkoutError}</p>
              )}
            </CardContent>
          </Card>

          {/* Enterprise */}
          <Card>
            <CardContent className="p-7">
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">Enterprise</p>
              <p className="text-3xl font-black text-foreground mt-2">Custom</p>
              <p className="text-xs text-muted-foreground mt-1">Talk to our team</p>
              <ul className="mt-6 space-y-2 text-sm text-foreground">
                {['Everything in Pro', 'Up to 10 brands', 'Unlimited history + CSV', 'White-label PDF reports', 'API access', 'Custom AI platforms', 'Dedicated support'].map(f => (
                  <li key={f} className="flex gap-2 items-center">
                    <Check className="size-3.5 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="mt-8 w-full" asChild>
                <a href="mailto:aeo@fimmick.com">Contact Sales</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
