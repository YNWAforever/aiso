const DATABASE_ERROR_CATEGORIES = {
  '23503': 'foreign_key_violation',
  '23505': 'unique_violation',
  '23514': 'check_violation',
  '42501': 'insufficient_privilege',
} as const

type DatabaseErrorCode = keyof typeof DATABASE_ERROR_CATEGORIES

export type SanitizedDatabaseError = {
  correlationId: string
  route: string
  code: DatabaseErrorCode | 'unknown'
  category: (typeof DATABASE_ERROR_CATEGORIES)[DatabaseErrorCode] | 'unknown'
}

type DatabaseErrorLike = {
  code?: unknown
}

function readDatabaseCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null

  const code = (error as DatabaseErrorLike).code
  return typeof code === 'string' ? code : null
}

function isDatabaseErrorCode(value: string): value is DatabaseErrorCode {
  return Object.prototype.hasOwnProperty.call(DATABASE_ERROR_CATEGORIES, value)
}

/**
 * Convert an unknown database error into the small, JSON-safe diagnostic
 * contract used by server logs. Error messages and metadata are intentionally
 * not read or copied so tenant content cannot cross the observability boundary.
 */
export function sanitizeDatabaseError(
  error: unknown,
  context: { correlationId: string; route: string },
): SanitizedDatabaseError {
  const code = readDatabaseCode(error)
  if (!code || !isDatabaseErrorCode(code)) {
    return {
      correlationId: context.correlationId,
      route: context.route,
      code: 'unknown',
      category: 'unknown',
    }
  }

  return {
    correlationId: context.correlationId,
    route: context.route,
    code,
    category: DATABASE_ERROR_CATEGORIES[code],
  }
}
