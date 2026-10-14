type TopicalEvidenceState = 'observed' | 'unavailable' | 'legacy'

/** Read-only projection: stored placeholder scores cannot prove an assessment. */
export function topicalAuthorityState(value: unknown): TopicalEvidenceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'legacy'
  const check = value as { message?: unknown; diagnostic?: { collection?: unknown; reason?: unknown } }
  if (['topical_authority_no_sitemap', 'topical_authority_unstructured', 'topical_authority_unavailable'].includes(String(check.message))) return 'unavailable'
  if (!check.diagnostic) return 'legacy'
  return ['complete', 'partial'].includes(String(check.diagnostic.collection))
    && check.diagnostic.reason !== 'provider-fallback'
    && ['topical_authority_pass', 'topical_authority_warn', 'topical_authority_fail'].includes(String(check.message))
    ? 'observed' : 'unavailable'
}
