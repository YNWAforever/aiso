import { describe, expect, it } from 'vitest'
import { sanitizeAxeResults } from '@/lib/axe-report'

describe('sanitizeAxeResults', () => {
  it('keeps diagnostic rule and selector data without page content or arbitrary axe data', () => {
    const result = sanitizeAxeResults({
      url: 'https://example.test/private?email=person@example.test',
      timestamp: '2026-08-10T00:00:00.000Z',
      violations: [{
        id: 'label',
        impact: 'critical',
        description: 'Ensure every form element has a label',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
        tags: ['cat.forms'],
        nodes: [{
          target: ['#email'],
          html: '<input id="email" value="person@example.test">',
          failureSummary: 'Fix any of the following: page content',
          any: [{ id: 'label', impact: 'critical', message: 'Needs label', data: { secret: 'nope' } }],
          all: [],
          none: [],
        }],
      }],
      passes: [{
        id: 'button-name',
        impact: null,
        description: 'Ensure buttons have discernible text',
        help: 'Buttons must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
        tags: ['cat.name-role-value'],
        nodes: [{ target: ['button[type="submit"]'], any: [], all: [], none: [] }],
      }],
      incomplete: [{
        id: 'color-contrast',
        impact: null,
        description: 'Ensure contrast',
        help: 'Elements must meet minimum contrast ratio',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        tags: ['cat.color'],
        nodes: [{ target: ['.muted-copy'], any: [], all: [], none: [] }],
      }],
      inapplicable: [],
      testEngine: { name: 'axe-core' },
    })

    expect(result).toEqual({
      violations: [{
        id: 'label',
        impact: 'critical',
        description: 'Ensure every form element has a label',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
        tags: ['cat.forms'],
        nodeCount: 1,
        targets: [['#email']],
      }],
      passes: [{
        id: 'button-name',
        impact: null,
        description: 'Ensure buttons have discernible text',
        help: 'Buttons must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
        tags: ['cat.name-role-value'],
        nodeCount: 1,
        targets: [['button[type="submit"]']],
      }],
      incomplete: [{
        id: 'color-contrast',
        impact: null,
        description: 'Ensure contrast',
        help: 'Elements must meet minimum contrast ratio',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        tags: ['cat.color'],
        nodeCount: 1,
        targets: [['.muted-copy']],
      }],
    })
    expect(JSON.stringify(result)).not.toContain('person@example.test')
    expect(JSON.stringify(result)).not.toContain('page content')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
