/** Canonical path comparison for captured repository identity. @module @deepseek-ai/dsh-command-code-review/repository-path */

import { resolve } from 'node:path'

/** Compare canonical paths using the host filesystem's case rules.
 * @param left - first path to resolve.
 * @param right - second path to resolve.
 * @param platform - platform whose path case rules apply.
 * @returns whether the resolved paths identify the same repository root.
 */
export function sameRepositoryPath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  const normalize = (path: string): string => resolve(path).replace(/[\\/]+$/u, '')
  const resolvedLeft = normalize(left)
  const resolvedRight = normalize(right)
  return platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}
