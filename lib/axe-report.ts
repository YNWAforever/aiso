type AxeNode = {
  target?: unknown
}

type AxeRule = {
  id?: unknown
  impact?: unknown
  description?: unknown
  help?: unknown
  helpUrl?: unknown
  tags?: unknown
  nodes?: unknown
}

type AxeResult = {
  violations?: unknown
  passes?: unknown
  incomplete?: unknown
}

export type SanitizedAxeRule = {
  id: string
  impact: string | null
  description: string
  help: string
  helpUrl: string
  tags: string[]
  nodeCount: number
  targets: string[][]
}

export type SanitizedAxeResults = {
  violations: SanitizedAxeRule[]
  passes: SanitizedAxeRule[]
  incomplete: SanitizedAxeRule[]
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function sanitizeRule(rule: AxeRule): SanitizedAxeRule {
  const nodes = Array.isArray(rule.nodes) ? rule.nodes as AxeNode[] : []

  return {
    id: stringOrEmpty(rule.id),
    impact: typeof rule.impact === 'string' ? rule.impact : null,
    description: stringOrEmpty(rule.description),
    help: stringOrEmpty(rule.help),
    helpUrl: stringOrEmpty(rule.helpUrl),
    tags: stringArray(rule.tags),
    nodeCount: nodes.length,
    targets: nodes.map(node => stringArray(node.target)),
  }
}

function sanitizeRules(value: unknown): SanitizedAxeRule[] {
  return Array.isArray(value) ? value.map(rule => sanitizeRule(rule as AxeRule)) : []
}

/**
 * Preserves axe rule diagnostics while excluding document URLs, HTML, failure
 * summaries, timestamps, and arbitrary check data that can contain page content.
 */
export function sanitizeAxeResults(results: AxeResult): SanitizedAxeResults {
  return {
    violations: sanitizeRules(results.violations),
    passes: sanitizeRules(results.passes),
    incomplete: sanitizeRules(results.incomplete),
  }
}
