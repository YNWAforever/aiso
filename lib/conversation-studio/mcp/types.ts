/**
 * The internal Studio MCP surface is read-only in its first phase. Every tool
 * runs with a principal the transport established from a session or a signed
 * internal token: an account, one brand and the member who asked. A tool never
 * accepts an account id, brand id or profile id from its arguments — the model
 * cannot choose whose data it reads.
 */
export type StudioMcpAudience = 'internal'

export type StudioMcpEntitlements = {
  /** Saved Search Console metrics are readable only when the plan grants them. */
  search_console: boolean
}

export type StudioMcpPrincipal = {
  accountId: string
  clientId: string
  profileId: string
  entitlements: StudioMcpEntitlements
}

export type StudioMcpErrorCode = 'INVALID_ARGUMENTS' | 'FEATURE_UNAVAILABLE' | 'UNAVAILABLE'

export type StudioMcpFailure = {
  ok: false
  error: StudioMcpErrorCode
  message: string
}

export type StudioMcpSuccess<T = unknown> = {
  ok: true
  data: T
}

export type StudioMcpResult<T = unknown> = StudioMcpSuccess<T> | StudioMcpFailure
