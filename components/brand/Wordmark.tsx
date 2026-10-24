import { BRAND } from '@/lib/brand'
import { cn } from '@/lib/utils'

/**
 * The product name as a two-tone wordmark: "Fimmick" then "AISO" in the
 * accent colour. The one place the name is drawn, so it is spelled the same
 * everywhere. Needs no translation provider: the name is the same in every
 * language, and some surfaces (onboarding) read copy without one.
 */
export function Wordmark({ className, accentClassName = 'text-primary' }: { className?: string; accentClassName?: string }) {
  return <span className={className}>{BRAND.company} <span className={cn(accentClassName)}>{BRAND.product}</span></span>
}
