/** Read-only Git command validation shared with the workflow tests. @module */

import { HarnessError } from '@deepseek-ai/dsh-llm'

const READ_ONLY_GIT_VERBS = new Set(['rev-parse', 'branch', 'diff', 'ls-files', 'cat-file', 'check-ignore'])

/** Reject Git arguments whose first positional argument is not an approved read-only builtin.
 * @param args - Git arguments without the executable name.
 */
export function assertReadOnlyGitCommand(args: readonly string[]): void {
  const verb = args.find(argument => argument !== '--' && !argument.startsWith('-'))
  if (verb === undefined || !READ_ONLY_GIT_VERBS.has(verb)) {
    throw new HarnessError('repository inspection only permits fixed read-only Git commands', 'GIT_COMMAND_DENIED')
  }
}
