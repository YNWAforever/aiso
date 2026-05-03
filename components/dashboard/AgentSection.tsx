'use client'

type AgentSectionProps = {
  status: string | null | undefined
  children: React.ReactNode
}

const PLATFORMS = [
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini' },
  { id: 'perplexity/sonar', label: 'Perplexity' },
  { id: 'perplexity/sonar-pro', label: 'Sonar Pro' },
]

export function AgentSection({ status, children }: AgentSectionProps) {
  if (!status) return null

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-[#ef444420] bg-[#0d0d18] p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-2 h-2 rounded-full bg-[#ef4444] shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#e0e0ec] mb-0.5">Agent Analysis</p>
            <p className="text-[11px] text-[#ef4444]">Agent analysis encountered an error. Try running a new scan.</p>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'pending' || status === 'running') {
    return (
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
        <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">Agent Analysis</p>
        <div className="flex items-center gap-4 flex-wrap">
          {PLATFORMS.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2"
              style={{ animationDelay: `${i * 200}ms`, opacity: 0, animation: 'fade-up 0.4s ease-out forwards' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] animate-pulse"
                style={{ animationDelay: `${i * 300}ms` }} />
              <span className="text-[11px] text-[#5c5c6e] font-mono">{p.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#3c3c4e] mt-4 font-mono">
          {status === 'pending' ? '$ agent_analysis --queue' : '$ agent_analysis --running'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase">Agent Analysis</p>
      {children}
    </div>
  )
}
