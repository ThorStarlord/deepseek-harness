/** Read-only Git command allowlist for repository review. @module @deepseek-ai/dsh-command-code-review/git-command */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Reject a Git invocation unless its first verb is used by the fixed review reader.
 * @param args - Git arguments excluding the executable name.
 * @returns nothing when the verb is permitted.
 * @throws when the first command is missing or is not a read-only review verb.
 */
export function assertReadOnlyGitCommand(args: readonly string[]): void {
  const command = args.find(argument => argument !== '--' && !argument.startsWith('-'))
  if (command === undefined || !['rev-parse', 'branch', 'status', 'diff', 'ls-files', 'check-ignore'].includes(command)) {
    throw new HarnessError('Repository review permits only fixed read-only Git commands.', 'REVIEW_GIT_COMMAND_DENIED')
  }
}
