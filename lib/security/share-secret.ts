/**
 * REPORT_SHARE_SECRET, stated once.
 *
 * The variable has two independent consumers — lib/reports/share.ts (signed
 * public report links) and lib/security/scan-claim-intent.ts (the signed
 * scan-claim cookie) — which each carried their own copy of the same 32-char
 * rule. Two copies of a security invariant is one too many, and the duplication
 * hid the variable's real blast radius: it does not just gate report sharing,
 * it gates the scan-to-signup claim funnel too.
 *
 * Throws rather than falling back. Both callers sign or verify with it, so a
 * weak or absent secret must fail loudly, never silently produce forgeable
 * tokens.
 */
export function shareSigningSecret(): string {
  const secret = process.env.REPORT_SHARE_SECRET
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('REPORT_SHARE_SECRET must contain at least 32 random characters')
  }
  return secret
}
