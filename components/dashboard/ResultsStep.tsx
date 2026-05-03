import { ScanSummary } from '@/components/dashboard/ScanSummary'
import type { Scan } from '@/lib/types'

type Props = { scan: Scan }

export function ResultsStep({ scan }: Props) {
  return <ScanSummary scan={scan} />
}
