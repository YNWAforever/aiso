import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { VersionWorkspace, type VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'
import { OutcomeWorkspace } from '@/components/outcomes/OutcomeWorkspace'

export type C9EVersionWorkspaceFixtureProps = VersionWorkspaceProps & {
  /** Controlled child-prop lifecycle witness, separate from real parent history selection. */
  outcomeOnly?: boolean
  outcomeRefreshKey?: number
}
/** Route-prop changes exercise the real workspace's existing ownership boundary. */
export function C9EVersionWorkspaceFixture(initial: C9EVersionWorkspaceFixtureProps) {
  const [props, setProps] = useState(initial)
  useEffect(() => {
    const change = (event: Event) => {
      const next = (event as CustomEvent<C9EVersionWorkspaceFixtureProps>).detail
      // Direct-child tests can observe a committed render before its scheduled GET starts.
      if (next.outcomeOnly) flushSync(() => setProps(next))
      else setProps(next)
    }
    window.addEventListener('fixture-delivery-scope', change)
    return () => window.removeEventListener('fixture-delivery-scope', change)
  }, [])
  if (props.outcomeOnly) {
    if (!props.initialVersion) throw Error('Controlled outcome fixture requires a selected version')
    return <OutcomeWorkspace clientId={props.clientId} itemId={props.workItemId} version={props.initialVersion}
      viewerKey={props.outcomeViewerKey} refreshKey={props.outcomeRefreshKey ?? 0} smeCopilot={props.smeCopilot} />
  }
  return <VersionWorkspace {...props} />
}
