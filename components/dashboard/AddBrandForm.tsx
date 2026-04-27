'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  lang: string
  compact?: boolean
}

export function AddBrandForm({ lang, compact }: Props) {
  const [open, setOpen]       = useState(false)
  const [name, setName]       = useState('')
  const [domain, setDomain]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/dashboard/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_name: name, domain }),
    })
    if (!res.ok) {
      setError('Something went wrong. Please try again.')
      setLoading(false)
      return
    }
    router.refresh()
    setOpen(false)
    setName('')
    setDomain('')
    setLoading(false)
  }

  if (compact) {
    return open ? (
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Brand name"
          required
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="example.com (optional)"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
        >
          {loading ? '…' : 'Add'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm">
          Cancel
        </button>
      </form>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 transition"
      >
        + Add Brand
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 max-w-xs mx-auto">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Brand name (e.g. Fimmick)"
        required
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        value={domain}
        onChange={e => setDomain(e.target.value)}
        placeholder="Website domain (optional)"
        className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition"
      >
        {loading ? 'Adding…' : 'Add Brand →'}
      </button>
      <p className="text-xs text-slate-400 text-center">
        Pulse monitoring will begin on the next weekly scan.
      </p>
    </form>
  )
}
