/** Test driver for a repository-analysis turn through a shipped headless profile. */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-working-directory'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../core/agent-loop/tests/mock-adapter.ts'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const execFileAsync = promisify(execFile)
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('multi-repository Loader driver requires a config path')

const cwd = process.cwd()
const alphaPath = join(cwd, 'repositories', 'alpha')
const betaPath = join(cwd, 'repositories', 'beta')
await initializeRepository(alphaPath, 'analysis-alpha', 'ALPHA REPOSITORY INSTRUCTIONS')
await initializeRepository(betaPath, 'release-beta', 'BETA REPOSITORY INSTRUCTIONS')
await writeFile(join(cwd, 'repository-source-before.json'), JSON.stringify(await snapshotRepositories([alphaPath, betaPath])))

const ctx = await bootProductionProfile({
  binName: 'multi-repository-loader-e2e',
  profile: 'headless',
  overlayPaths: [
    resolveConfigPath(configPath, undefined),
    fileURLToPath(new URL('../../../../../bundle/web-app/presets/multi-repository-read-only.patch.yml', import.meta.url)),
  ],
})

const parentId = SessionId(`multi-repository-parent-${randomUUID()}`)
const selectedPaths = [alphaPath, betaPath] as const
const adapter = new MockAdapter(Array.from({ length: 80 }, () => dispatch))
ctx.llm.registerAdapter(['fixture'], adapter)
const parent = await ctx.agentLoop.create(parentId, { provider: 'fixture', model: 'fixture' }, { cwd })
await ctx.workspaceRegistry.create(alphaPath, 'Alpha')
await ctx.workspaceRegistry.create(betaPath, 'Beta')
const childAttribution: { readonly sessionId: string; readonly runId: string; readonly cwd: string }[] = []
const stopAttribution = ctx.on('subagent/start', ({ id, runId }) => {
  const child = ctx.agents.get(id)
  if (child === undefined) return
  childAttribution.push({
    sessionId: String(child.session.id),
    runId: String(runId),
    cwd: ctx.workingDirectory.get(child.session),
  })
})
const stopApproval = ctx.on('approval/request', request => Promise.resolve<ApprovalOutcome>(
  request.toolName === 'coordinate_repositories' ? 'allowed-once' : 'rejected',
))

try {
  const turn = await runFixtureTurn(ctx, {
    task: `Analyze the current source in ${alphaPath} and ${betaPath}, then compare the findings.`,
  })
  const resultEvent = parent.session.snapshotEvents().find(event => event.type === 'tool/result')
  const evidence = resultEvent === undefined ? '' : JSON.stringify(resultEvent)
  if (!evidence.includes('ALPHA REPOSITORY INSTRUCTIONS') || !evidence.includes('BETA REPOSITORY INSTRUCTIONS')) {
    throw new Error('parent result omitted repository-specific child findings')
  }
  process.stdout.write(`MULTI_REPOSITORY_RESULT ${JSON.stringify({
    parentSessionId: turn.sessionId,
    parentOutput: turn.output,
    resultEvent,
    childAttribution,
    repositoryPaths: selectedPaths,
    repositoryHeads: await Promise.all(selectedPaths.map(path => git(path, ['rev-parse', 'HEAD']))),
  })}\n`)
} finally {
  stopApproval()
  stopAttribution()
  await ctx.fiber.dispose()
}

function dispatch(request: GenerateOptions): StreamChunk[] {
  const hasToolResult = request.messages.some(message => message.role === 'tool')
  if (String(request.sessionId) === String(parentId)) {
    if (!hasToolResult) {
      return toolCallResponse('coordinate-repositories', 'coordinate_repositories', {
        repositories: selectedPaths,
        task: 'Compare the committed, staged, and working-tree source in each repository.',
      })
    }
    const transcript = JSON.stringify(request.messages)
    if (!transcript.includes('ALPHA REPOSITORY INSTRUCTIONS') || !transcript.includes('BETA REPOSITORY INSTRUCTIONS')) {
      throw new Error('coordinating parent did not receive both repository results')
    }
    return textResponse('Alpha: src/core.ts has separate staged and working-tree values. Beta: src/core.ts has separate staged and working-tree values.')
  }
  if (!hasToolResult) {
    return toolCallsResponse([
      { id: `read-working-${randomUUID()}`, name: 'repository_read_file', args: { path: 'src/core.ts' } },
      { id: `read-staged-${randomUUID()}`, name: 'read_staged_file', args: { path: 'src/core.ts' } },
      { id: `read-untracked-${randomUUID()}`, name: 'repository_read_file', args: { path: 'src/draft.ts' } },
    ])
  }
  const transcript = JSON.stringify(request.messages)
  const alpha = transcript.includes('ALPHA REPOSITORY INSTRUCTIONS')
  const expected = alpha ? ['working-alpha', 'staged-alpha', 'draft-alpha'] : ['working-beta', 'staged-beta', 'draft-beta']
  if (!expected.every(value => transcript.includes(value))) {
    throw new Error(`repository worker did not receive live, staged, and untracked content for ${alpha ? 'Alpha' : 'Beta'}`)
  }
  return textResponse(`${alpha ? 'ALPHA' : 'BETA'} REPOSITORY INSTRUCTIONS; src/core.ts:1 differs between staged and working tree; src/draft.ts:1 is untracked.`)
}

function toolCallsResponse(
  calls: readonly { readonly id: string; readonly name: string; readonly args: object }[],
): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const argumentsJson = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: argumentsJson.slice(0, 8) },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), argumentsDelta: argumentsJson.slice(8) },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: argumentsJson } },
    )
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: calls.length * 5 } })
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

async function initializeRepository(path: string, branch: string, instructions: string): Promise<void> {
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'AGENTS.md'), `${instructions}\n`)
  await writeFile(join(path, '.gitignore'), '.env\n')
  await writeFile(join(path, '.env'), 'fixture-secret\n')
  await writeFile(join(path, 'src', 'core.ts'), `export const value = "base-${branch}"\n`)
  await writeFile(join(path, 'src', 'draft.ts'), `draft-${branch}\n`)
  await git(path, ['init', '--initial-branch', branch])
  await git(path, ['add', '--', 'AGENTS.md', '.gitignore', 'src/core.ts'])
  await git(path, ['-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial'])
  const shortName = branch.startsWith('analysis') ? 'alpha' : 'beta'
  await writeFile(join(path, 'src', 'core.ts'), `export const value = "staged-${shortName}"\n`)
  await git(path, ['add', '--', 'src/core.ts'])
  await writeFile(join(path, 'src', 'core.ts'), `export const value = "working-${shortName}"\n`)
  await writeFile(join(path, 'src', 'draft.ts'), `draft-${shortName}\n`)
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

async function snapshotRepositories(paths: readonly string[]): Promise<string[]> {
  return await Promise.all(paths.map(async (root) => {
    const files = await Promise.all(['AGENTS.md', '.gitignore', '.env', 'src/core.ts', 'src/draft.ts'].map(async path => (
      [path, (await readFile(join(root, path))).toString('base64')] as const
    )))
    const index = await readFile(join(root, '.git', 'index'))
    return JSON.stringify({
      files,
      index: index.toString('base64'),
      branch: await git(root, ['branch', '--show-current']),
      head: await git(root, ['rev-parse', 'HEAD']),
      status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
    })
  }))
}
