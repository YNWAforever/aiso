'use client'

import { useState } from 'react'

/** The agency logo over its initials; a logo that fails to load leaves the initials showing. */
export function ReportLogo({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // Version-scoped same-origin proxy URLs intentionally bypass the build-time host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={48}
      height={48}
      alt={alt}
      className="absolute inset-0 size-12 bg-card object-contain"
      onError={() => setFailed(true)}
    />
  )
}
