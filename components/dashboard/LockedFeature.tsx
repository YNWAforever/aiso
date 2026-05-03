'use client'

type Props = {
  feature: string
  requiredPlan: string
  price: string
  children?: React.ReactNode
}

export function LockedFeature({ feature, requiredPlan, price, children }: Props) {
  return (
    <div className="relative rounded-xl border border-[#1e1e30] bg-[#0d0d18] overflow-hidden group">
      {/* Blurred preview */}
      {children && (
        <div className="opacity-20 blur-[2px] pointer-events-none select-none">
          {children}
        </div>
      )}

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#050510]/80 p-6">
        <svg className="w-8 h-8 text-[#5c5c6e] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <p className="text-sm font-semibold text-[#e0e0ec] mb-1">{feature}</p>
        <p className="text-xs text-[#5c5c6e] mb-4 font-mono">
          Available on {requiredPlan} — {price}
        </p>
        <button
          onClick={async () => {
            const res = await fetch('/api/stripe/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: requiredPlan.toLowerCase() }),
            })
            const data = await res.json()
            if (data.url) window.location.href = data.url
          }}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-[#050510] bg-[#a78bfa] hover:bg-[#b99aff] transition-colors"
        >
          Upgrade to {requiredPlan} →
        </button>
      </div>
    </div>
  )
}
