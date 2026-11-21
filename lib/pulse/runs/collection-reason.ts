export function collectionReason(code: string) {
  if (code.includes('OUTCOME_UNKNOWN')) return 'outcome_unknown'
  if (code === 'PROVIDER_NOT_CONFIGURED') return 'provider_not_configured'
  if (code === 'PLAN_HAS_NO_PLATFORMS') return 'entitlement_changed'
  return 'collection_failed'
}
