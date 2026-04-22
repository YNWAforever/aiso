'use client'
import { useTranslations } from 'next-intl'
import { useRouter, useParams } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'

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
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <span className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </span>
        <Link href={`/${otherLang}`} className="text-sm text-blue-600 hover:underline">
          {otherLabel}
        </Link>
      </nav>

      {/* Hero */}
      <main className="max-w-xl mx-auto px-6 py-20 text-center">
        <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold tracking-widest px-4 py-1 rounded-full mb-6">
          {t('home.badge')}
        </span>
        <h1 className="text-4xl font-black text-slate-900 leading-tight mb-3 whitespace-pre-line">
          {t('home.headline')}
        </h1>
        <p className="text-slate-500 mb-10">{t('home.subheadline')}</p>

        <form onSubmit={handleScan} className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={t('home.placeholder')}
            className="flex-1 border-2 border-blue-600 rounded-lg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {loading ? '…' : t('home.cta')}
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

        <p className="text-xs text-slate-400 mt-6">{t('home.trust')}</p>
      </main>
    </div>
  )
}
