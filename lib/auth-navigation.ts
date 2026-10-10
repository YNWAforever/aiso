import { safeReturnTo } from './auth-return-to'
export function normalizeAuthNext(lang: string, next?: string): string { return safeReturnTo(next, lang) }
