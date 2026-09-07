'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { normalizeEntityInput, type EntityDto } from '@/lib/entities/schema'

export type EntityCopy = Record<
  | 'title'
  | 'description'
  | 'privateLabel'
  | 'unverified'
  | 'unsaved'
  | 'saved'
  | 'displayName'
  | 'aliases'
  | 'aliasesHelp'
  | 'save'
  | 'saving'
  | 'reload'
  | 'reloading'
  | 'conflict'
  | 'saveError'
  | 'loadError'
  | 'invalid'
  | 'unauthenticated'
  | 'unavailable',
  string
>
type Props = {
  clientId: string
  brandName: string
  initialEntity: EntityDto | null
  copy: EntityCopy
}

function validEntity(value: unknown, clientId: string): value is EntityDto {
  if (!value || typeof value !== 'object') return false
  const entity = value as EntityDto
  if (
    entity.clientId !== clientId ||
    !Number.isInteger(entity.revision) ||
    entity.revision < 1 ||
    entity.verification !== 'unverified' ||
    typeof entity.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(entity.updatedAt))
  )
    return false
  try {
    normalizeEntityInput({
      displayName: entity.displayName,
      aliases: entity.aliases,
      expectedRevision: entity.revision,
    })
    return true
  } catch {
    return false
  }
}

// A changed client remounts all draft/request state. Unmounted requests are aborted
// and ignored even when a transport does not honor AbortSignal.
export function EntityEditor(props: Props) {
  return <EditorSession key={props.clientId} {...props} />
}
function EditorSession({ clientId, brandName, initialEntity, copy }: Props) {
  const [entity, setEntity] = useState(initialEntity)
  const [name, setName] = useState(initialEntity?.displayName ?? brandName)
  const [aliases, setAliases] = useState(
    initialEntity?.aliases.join('\n') ?? '',
  )
  const [dirty, setDirty] = useState(!initialEntity)
  const [busy, setBusy] = useState<'save' | 'reload' | null>(null)
  const [error, setError] = useState<keyof EntityCopy | null>(null)
  const [conflict, setConflict] = useState(false)
  const active = useRef(true)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      pending.current?.abort()
    }
  }, [])

  async function request(kind: 'save' | 'reload') {
    if (pending.current || (kind === 'save' && conflict)) return
    let input
    if (kind === 'save') {
      try {
        input = normalizeEntityInput({
          displayName: name,
          aliases: aliases.split('\n').filter((value) => value.trim()),
          expectedRevision: entity?.revision ?? 0,
        })
      } catch {
        setError('invalid')
        return
      }
    }
    const controller = new AbortController()
    pending.current = controller
    setBusy(kind)
    setError(null)
    try {
      const response = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/entity`,
        {
          method: kind === 'save' ? 'PUT' : 'GET',
          cache: 'no-store',
          signal: controller.signal,
          ...(input
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
              }
            : {}),
        },
      )
      if (!active.current) return
      if (response.status === 409) {
        setConflict(true)
        setError('conflict')
        return
      }
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'unauthenticated'
            : response.status === 404
              ? 'unavailable'
              : response.status === 400
                ? 'invalid'
                : kind === 'save'
                  ? 'saveError'
                  : 'loadError',
        )
        return
      }
      const body: unknown = await response.json()
      if (!active.current) return
      if (!body || typeof body !== 'object' || !('entity' in body))
        throw new Error('invalid response')
      const next = body.entity
      if (!(kind === 'reload' && next === null) && !validEntity(next, clientId))
        throw new Error('invalid response')
      if (kind === 'save') {
        if (!input || !validEntity(next, clientId))
          throw new Error('invalid response')
        const returned = normalizeEntityInput({
          displayName: next.displayName,
          aliases: next.aliases,
          expectedRevision: next.revision,
        })
        // Lost-response retries can acknowledge an identical payload several
        // revisions later. A newer revision alone does not prove our draft saved.
        if (
          next.revision <= input.expectedRevision ||
          returned.displayName !== input.displayName ||
          JSON.stringify(returned.aliases) !== JSON.stringify(input.aliases)
        )
          throw new Error('invalid save acknowledgment')
      }
      const saved = next as EntityDto | null
      setEntity(saved)
      setName(saved?.displayName ?? brandName)
      setAliases(saved?.aliases.join('\n') ?? '')
      setDirty(!saved)
      setConflict(false)
    } catch {
      if (active.current) setError(kind === 'save' ? 'saveError' : 'loadError')
    } finally {
      if (active.current) {
        pending.current = null
        setBusy(null)
      }
    }
  }
  const fieldClass =
    'min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-6 p-4 md:p-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-primary">
          {copy.privateLabel}
        </p>
        <h1 className="text-2xl font-bold text-foreground">{copy.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
      </header>
      <section
        className="space-y-5 rounded-xl border border-border bg-card p-4 md:p-6"
        aria-label={copy.title}
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1 font-medium text-foreground">
            {copy.unverified}
          </span>
          <span
            role="status"
            aria-live="polite"
            className="text-muted-foreground"
          >
            {busy
              ? copy[busy === 'save' ? 'saving' : 'reloading']
              : dirty
                ? copy.unsaved
                : copy.saved}
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void request('save')
          }}
          className="space-y-5"
          aria-busy={!!busy}
        >
          <div className="space-y-2">
            <label
              htmlFor="entity-name"
              className="block text-sm font-semibold"
            >
              {copy.displayName}
            </label>
            <input
              id="entity-name"
              required
              value={name}
              disabled={!!busy}
              onChange={(event) => {
                setName(event.target.value)
                setDirty(true)
              }}
              className={fieldClass}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="entity-aliases"
              className="block text-sm font-semibold"
            >
              {copy.aliases}
            </label>
            <p
              id="entity-aliases-help"
              className="text-sm text-muted-foreground"
            >
              {copy.aliasesHelp}
            </p>
            <textarea
              id="entity-aliases"
              aria-describedby="entity-aliases-help"
              rows={5}
              value={aliases}
              disabled={!!busy}
              onChange={(event) => {
                setAliases(event.target.value)
                setDirty(true)
              }}
              className={fieldClass}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {copy[error]}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              className="min-h-11 whitespace-normal"
              disabled={!!busy || conflict || !dirty}
            >
              {busy === 'save' ? copy.saving : copy.save}
            </Button>
            {conflict && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 whitespace-normal"
                disabled={!!busy}
                onClick={() => void request('reload')}
              >
                {busy === 'reload' ? copy.reloading : copy.reload}
              </Button>
            )}
          </div>
        </form>
      </section>
    </main>
  )
}
