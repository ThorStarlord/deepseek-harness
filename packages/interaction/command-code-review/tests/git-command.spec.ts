import { describe, expect, it } from 'vitest'
import { assertReadOnlyGitCommand, gitNullDevice } from '../src/git-command.ts'

describe('read-only review Git command allowlist', () => {
  it('accepts only the fixed read-only Git verbs', () => {
    for (const command of ['rev-parse', 'branch', 'status', 'diff', 'ls-files', 'check-ignore']) {
      expect(() =>{  assertReadOnlyGitCommand(['--literal-pathspecs', command, '--', 'source.ts']) }).not.toThrow()
    }
  })

  it('rejects a missing command and mutation-capable Git verbs', () => {
    for (const args of [[], ['--literal-pathspecs'], ['reset', '--hard'], ['clean', '-fd']]) {
      expect(() =>{  assertReadOnlyGitCommand(args) }).toThrow('Repository review permits only fixed read-only Git commands.')
    }
  })

  it('uses the correct null device for both host families', () => {
    expect(gitNullDevice('win32')).toBe('NUL')
    expect(gitNullDevice('linux')).toBe('/dev/null')
  })
})
