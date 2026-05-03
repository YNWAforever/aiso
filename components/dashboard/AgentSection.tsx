'use client'

type AgentSectionProps = {
  status: string | null | undefined
  children: React.ReactNode
}

const PLATFORM_ICONS = ['openai/gpt-4o', 'anthropic/claude-haiku-4-5', 'google/gemini-2.0-flash-001', 'perplexity/sonar', 'perplexity/sonar-pro']

export function AgentSection({ status, children }: AgentSectionProps) {
  if (!status) return null

  if (status === 'error') {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Agent Analysis</p>
        <p className="text-xs text-red-600">Agent analysis encountered an error. Try running a new scan.</p>
      </div>
    )
  }

  if (status === 'pending' || status === 'running') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm font-semibold text-slate-700 mb-4">Agent Analysis</p>
        <div className="flex items-center gap-3">
          {PLATFORM_ICONS.map((platform, i) => (
            <div
              key={platform}
              className="flex items-center gap-2 text-xs text-slate-400"
              style={{ animationDelay: `${i * 300}ms` }}
            >
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="truncate max-w-[100px]">{platform.split('/').pop()}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {status === 'pending' ? 'Agent analysis will start shortly...' : 'Agents are analyzing your results...'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-700">Agent Analysis</p>
      {children}
    </div>
  )
}
