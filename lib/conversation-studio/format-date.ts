import { formatDisplayDate } from '@/lib/format/date'

/** Studio's name for the shared display-date formatter (`lib/format/date.ts`). */
export function studioDate(value: string | null | undefined, locale: string, withTime = false): string {
  return formatDisplayDate(value, locale, { withTime })
}
