/**
 * Environment for fixed, read-only Git subprocesses.
 * @module @deepseek-ai/dsh-subprocess/read-only-git-environment
 */

/**
 * Build Git settings that ignore ambient user, system, and repository-selection state.
 * Callers still own the Git command allowlist, sandbox policy, output bounds, and process lifecycle.
 * @param platform - Host platform used to select the null device.
 * @returns A fresh environment with system/global configuration and ambient repository selectors disabled.
 */
export function readOnlyGitEnvironment(platform: NodeJS.Platform): Record<string, string | undefined> {
  const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null'
  return {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'core.hooksPath',
    GIT_CONFIG_VALUE_1: nullDevice,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: nullDevice,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_COMMON_DIR: undefined,
    GIT_PREFIX: undefined,
    GIT_OBJECT_DIRECTORY: undefined,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
    GIT_NO_REPLACE_OBJECTS: '1',
  }
}
