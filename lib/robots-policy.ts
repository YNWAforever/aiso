/** Roles verified against provider documentation; see docs/contracts/robots-policy.md. */
export const AI_CRAWLER_ROLES = [
  { token: 'OAI-SearchBot', role: 'search', automatic: true },
  { token: 'GPTBot', role: 'training', automatic: true },
  { token: 'ChatGPT-User', role: 'user', automatic: false },
  { token: 'Claude-SearchBot', role: 'search', automatic: true },
  { token: 'ClaudeBot', role: 'training', automatic: true },
  { token: 'Claude-User', role: 'user', automatic: false },
  { token: 'PerplexityBot', role: 'search', automatic: true },
  { token: 'Perplexity-User', role: 'user', automatic: false },
  { token: 'Google-Extended', role: 'control', automatic: true },
  // Retained for benchmark compatibility; not advertised as a current provider token.
  { token: 'anthropic-ai', role: 'legacy', automatic: true },
] as const

type Rule = { allow: boolean; pattern: string }
type Group = { agents: string[]; rules: Rule[]; startedRules: boolean }

/** RFC 9309: decode unreserved octets only; reserved escaped bytes stay distinct. */
function normalizeOctets(value: string): string {
  return Array.from(value).map(char => char.codePointAt(0)! > 127 ? encodeURIComponent(char) : char).join('')
    .replace(/%[\da-f]{2}/gi, escape => {
      const char = String.fromCharCode(parseInt(escape.slice(1), 16))
      return /[a-z\d._~-]/i.test(char) ? char : escape.toUpperCase()
    })
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = []
  let current: Group | undefined
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n|\r/)) {
    const line = raw.split('#', 1)[0].trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (field === 'user-agent') {
      if (!current || current.startedRules) {
        current = { agents: [], rules: [], startedRules: false }
        groups.push(current)
      }
      if (value === '*' || /^[a-z_-]+$/i.test(value)) current.agents.push(value.toLowerCase())
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.startedRules = true
      if (value.startsWith('/') || value.startsWith('*')) current.rules.push({ allow: field === 'allow', pattern: normalizeOctets(value) })
    }
  }
  return groups
}

/** Wildcards without a regex: avoids exponential regex backtracking on hostile rules. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const glob = anchored ? pattern.slice(0, -1) : pattern + '*'
  let p = 0
  let i = 0
  let star = -1
  let checkpoint = 0
  while (i < path.length) {
    if (glob[p] === '*') { star = p++; checkpoint = i }
    else if (glob[p] === path[i]) { p++; i++ }
    else if (star >= 0) { p = star + 1; i = ++checkpoint }
    else return false
  }
  while (glob[p] === '*') p++
  return p === glob.length
}

/** Evaluates declared policy only: it does not prove any crawler visited or obeyed it. */
export function evaluateRobotsPolicy(text: string, agent: string, path = '/') {
  const groups = parseGroups(text)
  const specific = groups.filter(group => group.agents.includes(agent.toLowerCase()))
  const selected = specific.length ? specific : groups.filter(group => group.agents.includes('*'))
  const target = normalizeOctets(path).replace(/\*/g, '%2A').replace(/\$/g, '%24')
  if (target === '/robots.txt') return { allowed: true, explicit: specific.length > 0, source: 'implicit' as const }
  let specificity = -1
  let allowed = true
  for (const rule of selected.flatMap(group => group.rules)) {
    if (!matches(rule.pattern, target)) continue
    const octets = rule.pattern.replace(/%[\dA-F]{2}/g, '_').length
    if (octets > specificity || (octets === specificity && rule.allow)) {
      specificity = octets
      allowed = rule.allow
    }
  }
  return { allowed, explicit: specific.length > 0, source: specific.length ? 'agent' : selected.length ? 'wildcard' : 'none' } as const
}
