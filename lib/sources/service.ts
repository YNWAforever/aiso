import 'server-only'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import {
  IMPORT_METHODS,
  SOURCE_KINDS,
  SourceInputError,
  parseSourceCsv,
  parseSourceEntries,
  type ImportMethod,
  type SourceEntry,
  type SourceKind,
} from './schema'
import { approveSourceVersion, importSource, readSource, revokeSource, setAgentUse, type SourceScope } from './store'
import { listSourcePage } from './pagination'
import { parseSourceQuery } from './query'
import { previewSourceImport } from './import-preview'
import { buildSourcePack } from '@/lib/view-models/source-pack'
import { db } from '@/lib/db'
import { loadOwnedDraftClient } from '@/lib/work-items/store'

/**
 * Auth, then ownership, in that order and in one place, so a route cannot do one
 * of the two — the shape `lib/localTrust/guard.ts` established.
 *
 * Ownership failure is 404, because the client id came from the caller and
 * distinguishing "absent" from "not yours" would confirm another account's client
 * exists. A failed ownership *lookup* is 503, so a database incident cannot read
 * as "not yours". Ownership itself is enforced inside every statement in
 * `store.ts` rather than by a preceding check, so there is no window between the
 * two.
 */

const STATUS = {
  SOURCES_UNAUTHENTICATED: 401,
  SOURCES_INVALID_INPUT: 400,
  SOURCES_NOT_FOUND: 404,
  SOURCES_CONFLICT: 409,
  SOURCES_BODY_TOO_LARGE: 413,
  SOURCES_UNAVAILABLE: 503,
} as const

class SourceServiceError extends Error {
  constructor(readonly code: keyof typeof STATUS) { super(code) }
}

const headers = { 'Cache-Control': 'no-store' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })

function errorResponse(error: unknown): Response {
  if (error instanceof SourceServiceError) return json({ error: error.code }, STATUS[error.code])
  // An input error carries a specific, non-sensitive code the UI can localise.
  if (error instanceof SourceInputError) return json({ error: error.code }, error.code==='SOURCE_PAGE_CHANGED'?409:400)
  // Anything unrecognised is a dependency failure, never a silent success.
  return json({ error: 'SOURCES_UNAVAILABLE' }, 503)
}

async function authorize(clientId: string): Promise<SourceScope> {
  const profile = await getProfile()
  if (!profile) throw new SourceServiceError('SOURCES_UNAUTHENTICATED')
  if (typeof clientId !== 'string' || !clientId.trim()) throw new SourceServiceError('SOURCES_INVALID_INPUT')
  return { accountId: profile.account_id, clientId, actorId: profile.id }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown
  try {
    raw = await readLimitedJson(request, 262_144)
  } catch (error) {
    throw new SourceServiceError(
      error instanceof Error && error.message === 'APPROVAL_BODY_TOO_LARGE'
        ? 'SOURCES_BODY_TOO_LARGE' : 'SOURCES_INVALID_INPUT',
    )
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SourceServiceError('SOURCES_INVALID_INPUT')
  return raw as Record<string, unknown>
}

function choice<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new SourceInputError(code)
  return value as T
}

function text(value: unknown, code: string, max: number): string {
  if (typeof value !== 'string') throw new SourceInputError(code)
  const clean = value.normalize('NFC').trim()
  if (!clean.length || clean.length > max) throw new SourceInputError(code)
  return clean
}

/** Entries arrive either already structured, or as CSV text this parses. */
function entriesFrom(input: Record<string, unknown>, method: ImportMethod): SourceEntry[] {
  if (method === 'csv') {
    if (typeof input.csv !== 'string') throw new SourceInputError('SOURCE_CSV_EMPTY')
    return parseSourceCsv(input.csv)
  }
  return parseSourceEntries(input.entries)
}

export async function listClientSources(clientId: string,request?:Request): Promise<Response> {
  try {
    const scope = await authorize(clientId)
    const page=await listSourcePage(scope,parseSourceQuery(request?new URL(request.url).searchParams:new URLSearchParams(),scope.accountId,clientId))
    if(!page)throw new SourceServiceError('SOURCES_NOT_FOUND')
    return json({...page,sources:page.items,pack:buildSourcePack(page.items)})
  } catch (error) { return errorResponse(error) }
}
export async function previewClientSource(clientId:string,request:Request):Promise<Response>{
 try{
  const scope=await authorize(clientId)
  if(!await loadOwnedDraftClient(scope.accountId,clientId))throw new SourceServiceError('SOURCES_NOT_FOUND')
  const input=await body(request)
  const sourceKey=text(input.sourceKey,'SOURCE_KEY_INVALID',120).toLowerCase()
  const preview=typeof input.csv==='string'?previewSourceImport({csv:input.csv}):previewSourceImport({rows:input.rows as {rowNumber:number;question:string;answer:string}[]})
  const [source]=await db()`select latest_version from client_sources where account_id=${scope.accountId} and client_id=${clientId} and source_key=${sourceKey}`
  return json({...preview,expectedLatestVersion:Number(source?.latest_version??0)})
 }catch(error){return errorResponse(error)}
}

export async function importClientSource(clientId: string, request: Request): Promise<Response> {
  try {
    const scope = await authorize(clientId)
    const input = await body(request)
    const importMethod = choice(input.importMethod, IMPORT_METHODS, 'SOURCE_IMPORT_METHOD_INVALID')
    if(input.expectedLatestVersion!==undefined&&(!Number.isSafeInteger(input.expectedLatestVersion)||(input.expectedLatestVersion as number)<0))throw new SourceServiceError('SOURCES_INVALID_INPUT')
    let entries:SourceEntry[]
    if(input.previewRowCount!==undefined){
      if(importMethod!=='csv'||!Number.isSafeInteger(input.previewRowCount)||!Array.isArray(input.entries)||input.entries.length!==input.previewRowCount||input.expectedLatestVersion===undefined)throw new SourceInputError('SOURCE_PREVIEW_INVALID')
      const preview=previewSourceImport({rows:input.entries.map((entry,index)=>({...entry,rowNumber:index+1}))})
      if(preview.invalidCount||(input.previewContentHash!==null&&preview.contentHash!==input.previewContentHash))throw new SourceInputError('SOURCE_PREVIEW_INVALID')
      entries=preview.rows.map(row=>row.entry!)
    }else entries=entriesFrom(input,importMethod)
    const result = await importSource(scope, {
      sourceKey: text(input.sourceKey, 'SOURCE_KEY_INVALID', 120).toLowerCase(),
      kind: choice(input.kind, SOURCE_KINDS, 'SOURCE_KIND_INVALID') as SourceKind,
      label: text(input.label, 'SOURCE_LABEL_INVALID', 160),
      entries,
      importMethod,
      originRef: input.originRef === undefined || input.originRef === null
        ? null : text(input.originRef, 'SOURCE_ORIGIN_INVALID', 500),
      // Importing is not approving. The importer says so explicitly, and until
      // they do the source is excluded from agent use even when the flag is on —
      // see listAgentUsableSources.
      approve: input.approve === true,
      expectedLatestVersion:input.expectedLatestVersion as number|undefined,
    })
    if (result.kind === 'not-found') throw new SourceServiceError('SOURCES_NOT_FOUND')
    if (result.kind === 'revoked'||result.kind==='conflict') throw new SourceServiceError('SOURCES_CONFLICT')
    return json({ result: result.kind, approval: result.approval, source: result.source }, result.kind === 'created' ? 201 : 200)
  } catch (error) { return errorResponse(error) }
}

export async function updateClientSource(clientId: string, sourceId: string, request: Request): Promise<Response> {
  try {
    const scope = await authorize(clientId)
    const input = await body(request)
    if (input.revoke === true) {
      const revoked = await revokeSource(scope, sourceId)
      if (!revoked) throw new SourceServiceError('SOURCES_NOT_FOUND')
      return json({ source: revoked })
    }
    if (typeof input.agentUseAllowed !== 'boolean') throw new SourceServiceError('SOURCES_INVALID_INPUT')
    const updated = await setAgentUse(scope, sourceId, input.agentUseAllowed)
    if (!updated) throw new SourceServiceError('SOURCES_NOT_FOUND')
    return json({ source: updated })
  } catch (error) { return errorResponse(error) }
}

export async function readClientSource(clientId: string, sourceId: string): Promise<Response> {
  try {
    const scope = await authorize(clientId)
    const source = await readSource(scope, sourceId)
    if (!source) throw new SourceServiceError('SOURCES_NOT_FOUND')
    return json({ source })
  } catch (error) { return errorResponse(error) }
}

export async function approveClientSourceVersion(clientId: string, sourceId: string, versionId: string, request: Request): Promise<Response> {
  try {
    const scope = await authorize(clientId)
    const input = await body(request)
    if (!Number.isSafeInteger(input.expectedLatestVersion) || Number(input.expectedLatestVersion) < 1
      || typeof input.expectedContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedContentHash)
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sourceId)
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(versionId)) {
      throw new SourceServiceError('SOURCES_INVALID_INPUT')
    }
    const result = await approveSourceVersion(scope, { sourceId, versionId,
      expectedLatestVersion: Number(input.expectedLatestVersion), expectedContentHash: input.expectedContentHash })
    if (result.kind === 'not-found') throw new SourceServiceError('SOURCES_NOT_FOUND')
    if (result.kind === 'conflict' || result.kind === 'revoked') throw new SourceServiceError('SOURCES_CONFLICT')
    if (!('source' in result)) throw new SourceServiceError('SOURCES_CONFLICT')
    return json({ result: result.kind, source: result.source })
  } catch (error) { return errorResponse(error) }
}
