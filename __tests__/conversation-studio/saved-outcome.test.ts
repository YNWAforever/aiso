import { expect, it } from 'vitest'
import { SAVED_OUTCOME_EXCERPT_MAX, storedOutcomeExcerpt } from '@/lib/conversation-studio/saved-outcome'

it('returns one stored line from the first observation with an excerpt', () => {
  expect(storedOutcomeExcerpt({ observations: [
    { excerpt: null },
    { excerpt: '# Heading\n\nBody text with [a link](https://example.com) and **bold**.' },
  ] })).toBe('Heading')
})

it('collapses markdown and whitespace into a single readable line', () => {
  expect(storedOutcomeExcerpt({ observations: [{ excerpt: '  ## **Result**\n\n- first item  \n- second item ' }] }))
    .toBe('Result')
})

it('bounds the excerpt without splitting a surrogate pair', () => {
  const excerpt = storedOutcomeExcerpt({ observations: [{ excerpt: '😀'.repeat(SAVED_OUTCOME_EXCERPT_MAX + 10) }] })
  expect(excerpt).not.toBeNull()
  expect(Array.from(excerpt!)).toHaveLength(SAVED_OUTCOME_EXCERPT_MAX + 1)
  expect(excerpt!.endsWith('…')).toBe(true)
})

it('returns null rather than inventing a result when the stored reply has no excerpt', () => {
  expect(storedOutcomeExcerpt(null)).toBeNull()
  expect(storedOutcomeExcerpt({ observations: [{ excerpt: '   ' }] })).toBeNull()
  expect(storedOutcomeExcerpt({ observations: 'not-an-array' })).toBeNull()
  expect(storedOutcomeExcerpt({ status: 'insufficient' })).toBeNull()
})
