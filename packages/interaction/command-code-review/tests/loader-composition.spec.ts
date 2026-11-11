import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const processTimeoutMs = 120_000
const binScript = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/code-review.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('read-only code review production composition', () => {
  it('reviews live Git state through AgentLoop, loads project and user Skills, and preserves the repository', async () => {
    let repositoryRoot = ''
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'code-review-read-only',
      tempDirPrefix: 'dsh-code-review-loader-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      processTimeoutMs,
      env: {
        DSH_AGENTS_HOME: 'fixture-agent-home',
        DSH_PERMISSION_MODE: 'read-only',
        DSH_TELEMETRY_DISABLED: '1',
      },
      inspect: async (cwd) => {
        repositoryRoot = join(cwd, 'repository')
        const before = await readFile(join(cwd, 'repository-source-before.json'), 'utf8')
        expect(await snapshotRepository(repositoryRoot)).toBe(before)
      },
    })
    const outputLine = stdout.split(/\r?\n/u).find(line => line.startsWith('CODE_REVIEW_RESULT '))
    expect(outputLine).toBeDefined()
    const result = JSON.parse(outputLine?.slice('CODE_REVIEW_RESULT '.length) ?? '{}') as {
      readonly parentOutput?: string
      readonly commandResult?: { readonly kind: string; readonly text?: string }
      readonly deniedCommandResult?: { readonly kind: string; readonly text?: string }
      readonly parentSessionId?: string
      readonly repository?: {
        readonly root?: string
        readonly branch?: string
        readonly head?: string
        readonly changedDuringReview?: boolean
      }
      readonly reviewerRuns?: readonly {
        readonly sessionId?: string
        readonly runId?: string
        readonly cwd?: string
        readonly mode?: string
        readonly tools?: readonly string[]
        readonly attemptedTools?: readonly string[]
        readonly deniedTools?: readonly string[]
        readonly skillSources?: readonly string[]
      }[]
    }
    expect(stderr).toBe('')
    expect(result.commandResult?.kind).toBe('success')
    expect(result.commandResult?.text).toContain('reviewer Session')
    expect(result.commandResult?.text).toContain('working tree changed during review')
    expect(result.deniedCommandResult?.kind).toBe('error')
    expect(result.deniedCommandResult?.text).toContain('stopped with error')
    expect(result.parentOutput).toContain('PROJECT REVIEW SKILL LOADED')
    expect(result.parentOutput).toContain('USER EVIDENCE SKILL LOADED')
    expect(result.parentOutput).toContain('Repository:')
    expect(result.parentOutput).toContain('Committed HEAD:')
    expect(result.parentOutput).toContain('Working tree changed during review: yes')
    expect(result.repository?.root).toBe(repositoryRoot)
    expect(result.repository?.branch).toBe('review-priority-two')
    expect(result.repository?.head).toMatch(/^[a-f0-9]{40}$/u)
    expect(result.repository?.changedDuringReview).toBe(true)
    expect(result.parentSessionId).toBeDefined()
    expect(result.reviewerRuns).toHaveLength(2)
    const completed = result.reviewerRuns?.[0]
    const denied = result.reviewerRuns?.[1]
    expect(completed?.sessionId).toBeDefined()
    expect(completed?.sessionId).not.toBe(result.parentSessionId)
    expect(completed?.runId).toBeDefined()
    expect(completed?.cwd).toBe(repositoryRoot)
    expect(completed?.tools).toEqual(['skill'])
    expect(completed?.skillSources).toEqual(['project', 'user'])
    expect(completed?.attemptedTools).toEqual([])
    expect(completed?.deniedTools).toEqual([])
    expect(denied?.sessionId).toBeDefined()
    expect(denied?.sessionId).not.toBe(completed?.sessionId)
    expect(denied?.runId).toBeDefined()
    expect(denied?.cwd).toBe(repositoryRoot)
    expect(denied?.mode).toBe('deny-tools')
    expect(denied?.tools).toEqual(['skill'])
    expect(denied?.attemptedTools).toEqual([
      'bash', 'pwsh', 'write', 'edit', 'apply_patch', 'subagent', 'coordinate_repositories',
      'set_sandbox_mode', 'request_sandbox_escalation',
    ])
    expect(denied?.deniedTools).toEqual([
      'bash', 'pwsh', 'write', 'edit', 'apply_patch', 'subagent', 'coordinate_repositories',
      'set_sandbox_mode', 'request_sandbox_escalation',
    ])
  }, processTimeoutMs + 15_000)
})

async function snapshotRepository(root: string): Promise<string> {
  const files = [
    'AGENTS.md', 'CLAUDE.md', '.gitignore', '.env', 'ignored.log', 'src/AGENTS.md', 'src/core.ts', 'src/draft.ts',
    'src/blob.bin', 'src/invalid-utf8.bin', 'src/secrets.ts', 'src/credentials.json', 'src/id_ed25519', 'src/signing.p12',
    '.agents/skills/code-review/SKILL.md',
  ]
  const fileState = await Promise.all(files.map(async path => (
    [path, (await readFile(join(root, path))).toString('base64')] as const
  )))
  const index = await readFile(join(root, '.git', 'index'))
  return JSON.stringify({
    files: fileState,
    index: index.toString('base64'),
    branch: await git(root, ['branch', '--show-current']),
    head: await git(root, ['rev-parse', 'HEAD']),
    status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
  })
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
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
