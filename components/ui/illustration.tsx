export type IllustrationName = 'scan' | 'fixes' | 'tasks' | 'reports' | 'error' | 'brand' | 'questions' | 'monitor' | 'upgrade'

/**
 * First-pass two-tone spot illustrations. Token colours only, so they follow
 * the theme. Decorative: the heading next to them says what they mean.
 */
export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  // A className replaces the default size rather than merging with it. Its own
  // module with no imports, so a page that needs one illustration (onboarding's
  // upgrade card) does not bundle EmptyState and cn() with it.
  return (
    <svg aria-hidden="true" viewBox="0 0 120 88" className={className ?? 'h-20 w-28'} fill="none">
      <rect x="10" y="8" width="100" height="72" rx="10" className="fill-neutral-3" />
      {name === 'scan' && (<>
        <rect x="24" y="22" width="52" height="6" rx="3" className="fill-neutral-6" />
        <rect x="24" y="34" width="72" height="4" rx="2" className="fill-neutral-5" />
        <rect x="24" y="44" width="64" height="4" rx="2" className="fill-neutral-5" />
        <circle cx="80" cy="56" r="14" strokeWidth="5" className="stroke-primary" />
        <path d="M90 66l10 10" strokeWidth="5" strokeLinecap="round" className="stroke-primary" />
      </>)}
      {name === 'fixes' && (<>
        <path d="M34 50l10 10 22-26" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" className="stroke-tone-success" />
        <rect x="74" y="28" width="22" height="5" rx="2.5" className="fill-neutral-6" />
        <rect x="74" y="40" width="16" height="5" rx="2.5" className="fill-neutral-5" />
      </>)}
      {name === 'tasks' && [0, 1, 2].map(i => (
        <g key={i}>
          <rect x="24" y={22 + i * 16} width="10" height="10" rx="3" className={i === 0 ? 'fill-primary' : 'fill-neutral-6'} />
          <rect x="40" y={25 + i * 16} width={i === 1 ? 40 : 54} height="4" rx="2" className="fill-neutral-5" />
        </g>
      ))}
      {name === 'reports' && (<>
        <rect x="26" y="52" width="12" height="16" rx="2" className="fill-neutral-6" />
        <rect x="44" y="40" width="12" height="28" rx="2" className="fill-neutral-6" />
        <rect x="62" y="30" width="12" height="38" rx="2" className="fill-primary" />
        <rect x="80" y="44" width="12" height="24" rx="2" className="fill-neutral-6" />
      </>)}
      {name === 'brand' && (<>
        <rect x="30" y="34" width="60" height="34" rx="4" className="fill-neutral-6" />
        <path d="M26 34l8-14h52l8 14z" className="fill-primary" />
        <rect x="52" y="48" width="16" height="20" rx="2" className="fill-neutral-3" />
      </>)}
      {name === 'questions' && (<>
        <rect x="22" y="20" width="52" height="26" rx="8" className="fill-neutral-6" />
        <path d="M32 46l-4 10 14-10z" className="fill-neutral-6" />
        <rect x="50" y="42" width="48" height="24" rx="8" className="fill-primary" />
        <path d="M88 66l4 8-12-8z" className="fill-primary" />
      </>)}
      {name === 'monitor' && (<>
        <path d="M22 62l18-16 14 10 20-22 22 14" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary" />
        {[22, 40, 54, 74, 96].map((x, i) => <circle key={x} cx={x} cy={[62, 46, 56, 34, 48][i]} r="4" className="fill-neutral-6" />)}
      </>)}
      {name === 'upgrade' && (<>
        <path d="M60 18l20 24H68v24H52V42H40z" className="fill-primary" />
        <rect x="34" y="70" width="52" height="4" rx="2" className="fill-neutral-6" />
      </>)}
      {name === 'error' && (<>
        <path d="M60 22l26 44H34z" strokeWidth="5" strokeLinejoin="round" className="stroke-tone-warning" />
        <path d="M60 38v12" strokeWidth="5" strokeLinecap="round" className="stroke-tone-warning" />
        <circle cx="60" cy="58" r="3" className="fill-tone-warning" />
      </>)}
    </svg>
  )
}
