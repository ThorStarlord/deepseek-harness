import { describe, expect, it } from 'vitest'
import { readOnlyGitEnvironment } from '../src/read-only-git-environment.ts'

describe('read-only Git subprocess environment', () => {
  it('disables ambient Git configuration and repository selection on Windows', () => {
    expect(readOnlyGitEnvironment('win32')).toEqual({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: 'NUL',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'core.hooksPath',
      GIT_CONFIG_VALUE_1: 'NUL',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'NUL',
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_COMMON_DIR: undefined,
      GIT_PREFIX: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_NO_REPLACE_OBJECTS: '1',
    })
  })

  it('uses the POSIX null device without inheriting process state', () => {
    expect(readOnlyGitEnvironment('linux')).toMatchObject({
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_VALUE_1: '/dev/null',
      GIT_PAGER: '/dev/null',
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_NO_REPLACE_OBJECTS: '1',
    })
  })
})
