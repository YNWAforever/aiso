// Stub — full implementation in Task 8
interface Props { clientId: string }
export function AlertsTab({ clientId }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
      <p className="text-sm text-slate-400">Loading alerts…</p>
    </div>
  )
}
