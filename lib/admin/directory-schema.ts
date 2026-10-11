export const DIRECTORY_VIEWS = ['users', 'accounts', 'brands', 'scans', 'prompts', 'observations', 'runs', 'sources', 'work'] as const
export type DirectoryView = typeof DIRECTORY_VIEWS[number]
export const DIRECTORY_COLUMNS: Record<DirectoryView, readonly string[]> = {
  users: ['name', 'email', 'role', 'status', 'created_at'],
  accounts: ['name', 'plan', 'status', 'users', 'brands', 'created_at'],
  brands: ['name', 'domain', 'industry', 'status', 'created_at'],
  scans: ['domain', 'status', 'score', 'created_at'],
  prompts: ['name', 'brand', 'category', 'language', 'market', 'active'],
  observations: ['name', 'brand', 'platform', 'week', 'mentioned', 'excerpt'],
  runs: ['brand', 'status', 'week', 'updated_at'],
  sources: ['name', 'brand', 'kind', 'version', 'active', 'updated_at'],
  work: ['name', 'brand', 'status', 'updated_at'],
}
export type DirectoryQuery = { view: DirectoryView; q: string; page: number; accountId: string | null }
export type DirectoryRow = { id: string; account_id: string | null; [key: string]: string | number | boolean | null }
export type DirectoryResult = { rows: DirectoryRow[]; view: DirectoryView; page: number; hasMore: boolean }
export const PAGE_SIZE = 25
export function parseDirectoryQuery(query: URLSearchParams): DirectoryQuery {
  const view = query.get('view') ?? 'users', q = (query.get('q') ?? '').trim(), rawPage = query.get('page') ?? '1', accountId = query.get('accountId') || null
  if (!DIRECTORY_VIEWS.some(v => v === view) || q.length > 120 || !/^[1-9]\d{0,3}$/.test(rawPage)
    || (accountId && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(accountId))) throw new Error('Invalid directory query')
  return { view: view as DirectoryView, q, page: Number(rawPage), accountId }
}
