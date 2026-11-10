/**
 * Report target/headroom status and enforce hard ceilings from the budget manifest.
 * Missing files, invalid entries, and ceiling overruns fail; `--list` reports
 * every count. Only listed standing documents are budgeted.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inspectDocBudgets, parseDocBudgets } from './doc-budgets.ts'

const root = resolve(import.meta.dirname, '..')

const MANIFEST_PATH = resolve(root, 'scripts/doc-budgets.manifest.json')

const parsedManifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const manifest = parseDocBudgets(parsedManifest)

const listOnly = process.argv.includes('--list')
const report = inspectDocBudgets(manifest, (path) => {
  const abs = resolve(root, path)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined
})
const { failures, rows, policyWarningCount } = report

if (listOnly) {
  console.log(rows.join('\n'))
  process.exit(0)
}

if (failures.length > 0) {
  console.error('verify-doc-budgets failed:\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('\nSee docs/AGENTS.md for the documentation standard and the relocation-first rule.')
  process.exit(1)
}

console.log(
  `verify-doc-budgets: ${manifest.size} budgeted docs within hard ceilings; ${policyWarningCount} target/headroom warning(s). Run with --list for details.`,
)
