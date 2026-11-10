/**
 * Parses and evaluates maintained-document word budgets.
 * @module scripts/doc-budgets
 */

/** The desired word target and hard failure ceiling for one document. */
export interface DocBudget {
  readonly target: number
  readonly ceiling: number
}

/** The relation between a document's word count and its budget. */
export type DocBudgetStatus = 'within-headroom' | 'low-headroom' | 'above-target' | 'over-ceiling'

/** Rows, hard failures, and policy warnings from one budget-gate inspection. */
export interface DocBudgetInspection {
  readonly rows: readonly string[]
  readonly failures: readonly string[]
  readonly policyWarningCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/**
 * Parses the JSON manifest and requires a target and a ceiling for every file.
 * @param value Parsed manifest data.
 * @returns Validated repository-relative document budgets.
 * @throws {Error} If the manifest or any budget entry is invalid.
 */
export function parseDocBudgets(value: unknown): ReadonlyMap<string, DocBudget> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('manifest must be a non-empty object')
  }

  const budgets = new Map<string, DocBudget>()
  for (const [path, entry] of Object.entries(value)) {
    if (
      path.length === 0
      || !isRecord(entry)
      || !isPositiveInteger(entry.target)
      || !isPositiveInteger(entry.ceiling)
      || entry.ceiling < entry.target
    ) {
      throw new Error(`${path || '<empty path>'}: target and ceiling must be positive integers, with ceiling at least target`)
    }
    budgets.set(path, { target: entry.target, ceiling: entry.ceiling })
  }
  return budgets
}

/**
 * Classifies a whitespace-delimited word count against a document budget.
 * @param words Current word count.
 * @param budget The document's target and hard ceiling.
 * @returns Whether the count has headroom, exceeds the target, or exceeds the ceiling.
 */
export function assessDocBudget(words: number, budget: DocBudget): DocBudgetStatus {
  if (words > budget.ceiling) return 'over-ceiling'
  if (words > budget.target) return 'above-target'
  if (words * 20 > budget.target * 19) return 'low-headroom'
  return 'within-headroom'
}

/**
 * Reads listed documents through the supplied reader and classifies each budget.
 * @param budgets Validated document budgets.
 * @param readText Returns a document's contents, or `undefined` when it is missing.
 * @returns The rows, hard failures, and advisory target/headroom warning count.
 */
export function inspectDocBudgets(
  budgets: ReadonlyMap<string, DocBudget>,
  readText: (path: string) => string | undefined,
): DocBudgetInspection {
  const failures: string[] = []
  const rows: string[] = []
  let policyWarningCount = 0

  for (const [path, budget] of budgets) {
    const text = readText(path)
    if (text === undefined) {
      rows.push(`MISS  ${path}`)
      failures.push(`${path}: budgeted file does not exist (renamed or deleted? update scripts/doc-budgets.manifest.json in the same change)`)
      continue
    }

    const words = countWords(text)
    const status = assessDocBudget(words, budget)
    const label = {
      'within-headroom': 'OK',
      'low-headroom': 'LOW HEADROOM',
      'above-target': 'OVER TARGET',
      'over-ceiling': 'OVER CEILING',
    }[status]
    rows.push(`${label.padEnd(12)} ${String(words).padStart(6)} / target ${String(budget.target).padEnd(6)} / ceiling ${String(budget.ceiling).padEnd(6)} ${path}`)

    if (status === 'over-ceiling') {
      failures.push(`${path}: ${words} words exceeds the ${budget.ceiling}-word ceiling — relocate or condense per docs/AGENTS.md (raising the ceiling requires justification in the PR)`)
    } else if (status !== 'within-headroom') {
      policyWarningCount++
    }
  }

  return { rows, failures, policyWarningCount }
}

/**
 * Counts whitespace-delimited words, matching `wc -w` for these Markdown budgets.
 * @param text Document text.
 * @returns Number of whitespace-delimited words.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
