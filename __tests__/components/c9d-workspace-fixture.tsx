import { useEffect, useState } from 'react'
import { VersionWorkspace, type VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'

/** Test-only route-prop changes preserve the actual mounted component tree. */
export function VersionWorkspaceFixture(initial: VersionWorkspaceProps) {
  const [props, setProps] = useState(initial)
  useEffect(() => {
    const changeScope = (event: Event) => setProps((event as CustomEvent<VersionWorkspaceProps>).detail)
    window.addEventListener('fixture-review-scope', changeScope)
    return () => window.removeEventListener('fixture-review-scope', changeScope)
  }, [])
  return <VersionWorkspace {...props} />
}
