import { useEffect, useState } from 'react'
import { VersionWorkspace, type VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'

/** Route-prop changes exercise the real workspace's existing ownership boundary. */
export function C9EVersionWorkspaceFixture(initial: VersionWorkspaceProps) {
  const [props, setProps] = useState(initial)
  useEffect(() => {
    const change = (event: Event) => setProps((event as CustomEvent<VersionWorkspaceProps>).detail)
    window.addEventListener('fixture-delivery-scope', change)
    return () => window.removeEventListener('fixture-delivery-scope', change)
  }, [])
  return <VersionWorkspace {...props} />
}
