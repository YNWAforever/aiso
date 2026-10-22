import { cn } from '@/lib/utils'

/** Every landing section: an eyebrow, one heading (≤ 8 words), at most one line under it. */
export function SectionHeading({ id, eyebrow, title, subtitle, className, align = 'left' }: {
  id: string; eyebrow?: string; title: string; subtitle?: string; className?: string; align?: 'left' | 'center'
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && <p className="text-sm font-semibold text-primary-accessible">{eyebrow}</p>}
      <h2 id={id} className="mt-2 text-balance text-3xl font-black tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-pretty text-base text-muted-foreground">{subtitle}</p>}
    </div>
  )
}
