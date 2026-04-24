import Link from 'next/link'

interface Props {
  allowed: boolean
  children: React.ReactNode
  lang?: string
}

export function PlanGate({ allowed, children, lang = 'en' }: Props) {
  if (allowed) return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-4xl mb-4">🔒</div>
      <h2 className="text-lg font-semibold text-slate-900">Pro feature</h2>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        Edit your prompt bank and unlock advanced analytics on the Pro plan.
      </p>
      <Link
        href={`/${lang}/pricing`}
        className="mt-6 bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 transition"
      >
        Upgrade to Pro →
      </Link>
    </div>
  )
}
