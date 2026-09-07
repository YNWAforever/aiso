import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntityEditor } from '@/components/entities/EntityEditor'
const copy = Object.fromEntries(
  [
    'title',
    'description',
    'privateLabel',
    'unverified',
    'unsaved',
    'saved',
    'displayName',
    'aliases',
    'aliasesHelp',
    'save',
    'saving',
    'reload',
    'reloading',
    'conflict',
    'saveError',
    'loadError',
    'invalid',
    'unauthenticated',
    'unavailable',
  ].map((k) => [k, k]),
) as never

describe('private entity editor', () => {
  it('shows a clearly unsaved brand suggestion with labeled editable fields', () => {
    const html = renderToStaticMarkup(
      <EntityEditor
        clientId="client-a"
        brandName="Example Brand"
        initialEntity={null}
        copy={copy}
      />,
    )
    expect(html).toContain('value="Example Brand"')
    expect(html).toContain('unsaved')
    expect(html).toContain('unverified')
    expect(html).toContain('for="entity-name"')
    expect(html).toContain('for="entity-aliases"')
  })
  it('renders the saved entity rather than replacing it with the brand name', () => {
    const html = renderToStaticMarkup(
      <EntityEditor
        clientId="client-a"
        brandName="Old brand"
        initialEntity={{
          clientId: 'client-a',
          displayName: 'Private name',
          aliases: ['Alias'],
          revision: 2,
          verification: 'unverified',
          updatedAt: '2026-09-06T00:00:00Z',
        }}
        copy={copy}
      />,
    )
    expect(html).toContain('Private name')
    expect(html).toContain('Alias')
    expect(html).not.toContain('Old brand')
    expect(html).toContain('saved')
  })
})
