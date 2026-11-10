import { describe, expect, it } from 'vitest'
import { assessDocBudget, countWords, inspectDocBudgets, parseDocBudgets } from './doc-budgets.ts'

describe('document word budgets', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('  one\n two\tthree  ')).toBe(3)
  })

  it('accepts a count with exactly five percent headroom', () => {
    expect(assessDocBudget(95, { target: 100, ceiling: 110 })).toBe('within-headroom')
  })

  it('reports a count with less than five percent headroom', () => {
    expect(assessDocBudget(96, { target: 100, ceiling: 110 })).toBe('low-headroom')
  })

  it('reports counts above target while retaining the hard ceiling', () => {
    expect(assessDocBudget(101, { target: 100, ceiling: 110 })).toBe('above-target')
  })

  it('rejects counts above the hard ceiling', () => {
    expect(assessDocBudget(111, { target: 100, ceiling: 110 })).toBe('over-ceiling')
  })

  it('parses target and ceiling values from a non-empty manifest', () => {
    expect(parseDocBudgets({ 'docs/example.md': { target: 100, ceiling: 110 } })).toEqual(
      new Map([['docs/example.md', { target: 100, ceiling: 110 }]]),
    )
  })

  it('reports headroom and target warnings without hard failures', () => {
    const budgets = new Map([
      ['low.md', { target: 100, ceiling: 110 }],
      ['above.md', { target: 100, ceiling: 110 }],
    ])
    const texts = new Map([
      ['low.md', 'word '.repeat(96)],
      ['above.md', 'word '.repeat(101)],
    ])

    const report = inspectDocBudgets(budgets, path => texts.get(path))

    expect(report.rows[0]).toContain('LOW HEADROOM')
    expect(report.rows[1]).toContain('OVER TARGET')
    expect(report.failures).toEqual([])
    expect(report.policyWarningCount).toBe(2)
  })

  it('fails on missing files and hard-ceiling overruns', () => {
    const budgets = new Map([
      ['missing.md', { target: 100, ceiling: 110 }],
      ['over.md', { target: 100, ceiling: 110 }],
    ])

    const report = inspectDocBudgets(budgets, path => path === 'over.md' ? 'word '.repeat(111) : undefined)

    expect(report.rows[0]).toContain('MISS  missing.md')
    expect(report.rows[1]).toContain('OVER CEILING')
    expect(report.failures).toEqual([
      'missing.md: budgeted file does not exist (renamed or deleted? update scripts/doc-budgets.manifest.json in the same change)',
      'over.md: 111 words exceeds the 110-word ceiling — relocate or condense per docs/AGENTS.md (raising the ceiling requires justification in the PR)',
    ])
  })

  it.each([
    null,
    {},
    { 'docs/example.md': { target: 0, ceiling: 110 } },
    { 'docs/example.md': { target: 100, ceiling: 99 } },
    { 'docs/example.md': { target: 100, ceiling: 110.5 } },
  ])('rejects invalid manifest values: %s', (value) => {
    expect(() => parseDocBudgets(value)).toThrow()
  })
})
