export default function PublicReportNotFound() {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center overflow-x-clip bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-muted-foreground">Fimmick AISO</p>
        <h1 className="mt-3 text-2xl font-bold">Report not found</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          This report link is unavailable.
          <span lang="zh-HK" className="mt-2 block">此報告連結目前無法使用。</span>
        </p>
      </section>
    </main>
  )
}
