import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const execFileAsync = promisify(execFile)
const processTimeoutMs = 120_000
const binScript = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/read-only.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('multi-repository production composition', () => {
  it('runs dirty repository analysis through the shipped headless Loader and attributes both children', async () => {
    let repositoryRoots: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'multi-repository-read-only',
      tempDirPrefix: 'dsh-multi-repository-loader-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      processTimeoutMs,
      env: { DSH_PERMISSION_MODE: 'read-only', DSH_TELEMETRY_DISABLED: '1' },
      inspect: async (cwd) => {
        repositoryRoots = ['alpha', 'beta'].map(name => join(cwd, 'repositories', name))
        const before = JSON.parse(await readFile(join(cwd, 'repository-source-before.json'), 'utf8')) as readonly string[]
        expect(await snapshotRepositories(repositoryRoots)).toEqual(before)
      },
    })
    const outputLine = stdout.split(/\r?\n/u).find(line => line.startsWith('MULTI_REPOSITORY_RESULT '))
    expect(outputLine).toBeDefined()
    const result = JSON.parse(outputLine?.slice('MULTI_REPOSITORY_RESULT '.length) ?? '{}') as {
      readonly parentOutput?: string
      readonly resultEvent?: unknown
      readonly childAttribution?: readonly { readonly sessionId: string; readonly runId: string; readonly cwd: string }[]
      readonly repositoryPaths?: readonly string[]
      readonly repositoryHeads?: readonly string[]
    }
    expect(stderr).toBe('')
    expect(result.parentOutput).toContain('Alpha: src/core.ts')
    expect(result.parentOutput).toContain('Beta: src/core.ts')
    expect(JSON.stringify(result.resultEvent)).toContain('ALPHA REPOSITORY INSTRUCTIONS')
    expect(JSON.stringify(result.resultEvent)).toContain('BETA REPOSITORY INSTRUCTIONS')
    expect(result.childAttribution).toHaveLength(2)
    expect(new Set(result.childAttribution?.map(child => child.sessionId)).size).toBe(2)
    expect(new Set(result.childAttribution?.map(child => child.runId)).size).toBe(2)
    expect(result.childAttribution?.map(child => child.cwd).sort()).toEqual(repositoryRoots.sort())
    expect([...(result.repositoryPaths ?? [])].sort()).toEqual(repositoryRoots.sort())
    expect(result.repositoryHeads).toHaveLength(2)
    expect(result.repositoryHeads?.every(head => /^[a-f0-9]{40}$/u.test(head))).toBe(true)
  }, processTimeoutMs + 15_000)
})

async function snapshotRepositories(roots: readonly string[]): Promise<string[]> {
  return await Promise.all(roots.map(async (root) => {
    const files = await Promise.all(['AGENTS.md', '.gitignore', '.env', 'src/core.ts', 'src/draft.ts'].map(async path => (
      [path, (await readFile(join(root, path))).toString('base64')] as const
    )))
    const index = await readFile(join(root, '.git', 'index'))
    const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'])
    const branch = await git(root, ['branch', '--show-current'])
    const head = await git(root, ['rev-parse', 'HEAD'])
    return JSON.stringify({ files, index: index.toString('base64'), branch, head, status })
  }))
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const windows = process.platform === 'win32'
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  )
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = windows ? 'NUL' : '/dev/null'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return (await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd, env })).stdout.trim()
}
