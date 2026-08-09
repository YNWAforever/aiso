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
  inapplicable?: unknown
}

export type SanitizedAxeRule = {
  id: string
  impact: string | null
  description: string
  help: string
  helpUrl: string
  tags: string[]
  nodeCount: number
}

export type SanitizedAxeResults = {
  violations: SanitizedAxeRule[]
  passes: SanitizedAxeRule[]
  incomplete: SanitizedAxeRule[]
  inapplicable: SanitizedAxeRule[]
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function sanitizeRule(rule: AxeRule): SanitizedAxeRule {
  const nodes = Array.isArray(rule.nodes) ? rule.nodes : []

  return {
    id: stringOrEmpty(rule.id),
    impact: typeof rule.impact === 'string' ? rule.impact : null,
    description: stringOrEmpty(rule.description),
    help: stringOrEmpty(rule.help),
    helpUrl: stringOrEmpty(rule.helpUrl),
    tags: stringArray(rule.tags),
    nodeCount: nodes.length,
  }
}

function sanitizeRules(value: unknown): SanitizedAxeRule[] {
  return Array.isArray(value) ? value.map(rule => sanitizeRule(rule as AxeRule)) : []
}

/**
 * Preserves axe rule diagnostics while excluding document URLs, HTML, selector
 * targets, failure summaries, timestamps, and arbitrary check data that can
 * contain page content.
 */
export function sanitizeAxeResults(results: AxeResult): SanitizedAxeResults {
  return {
    violations: sanitizeRules(results.violations),
    passes: sanitizeRules(results.passes),
    incomplete: sanitizeRules(results.incomplete),
    inapplicable: sanitizeRules(results.inapplicable),
  }
}
