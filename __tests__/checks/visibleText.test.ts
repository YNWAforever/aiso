import { describe, it, expect } from 'vitest'
import { stripNonVisible, visibleText } from '@/lib/checks/visibleText'

// A page's <head> CSS and inline JSON are not its content. The GEO checks used
// to strip tags only, so `width:100%` and `"year":2024` were counted as facts.
const PAGE = `<html><head>
<style>.a{width:100%}.b{height:100%}</style>
<script>var cfg={"year":2024,"build":2023};</script>
<script type="application/ld+json">{"@type":"Organization","foundingDate":"1999"}</script>
</head><body>
<!-- hidden note: revenue grew 40% -->
<noscript>Enable JavaScript 2025</noscript>
<template><p>Template 50%</p></template>
<p>We sell shoes.</p>
</body></html>`

describe('visibleText', () => {
  it('keeps only the text a reader sees', () => {
    expect(visibleText(PAGE)).toBe('We sell shoes.')
  })

  it('drops non-visible blocks but keeps the markup of visible ones', () => {
    const stripped = stripNonVisible(PAGE)

    expect(stripped).toContain('<p>We sell shoes.</p>')
    expect(stripped).not.toMatch(/100%|2024|1999|40%|2025|50%/)
  })

  it('is case-insensitive and handles attributes on the opening tag', () => {
    expect(visibleText('<SCRIPT type="module">x=1</SCRIPT><p>Hi</p>')).toBe('Hi')
  })
})
