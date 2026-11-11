/** Drive `/review` through the production headless Loader and the real AgentLoop. */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-working-directory'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../core/agent-loop/tests/mock-adapter.ts'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const execFileAsync = promisify(execFile)
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('code-review Loader driver requires a config path')

const cwd = process.cwd()
const repositoryRoot = join(cwd, 'repository')
const forbiddenToolNames = ['bash', 'pwsh', 'write', 'edit', 'apply_patch', 'subagent', 'coordinate_repositories', 'set_sandbox_mode', 'request_sandbox_escalation'] as const
const userSkillsRoot = join(cwd, 'fixture-agent-home', 'skills')
await initializeRepository(repositoryRoot)
await mkdir(join(repositoryRoot, '.agents', 'skills', 'code-review'), { recursive: true })
await writeFile(join(repositoryRoot, '.agents', 'skills', 'code-review', 'SKILL.md'), [
  '---', 'name: code-review', 'description: Project review guidance for the fixture.', '---',
  '', 'PROJECT REVIEW SKILL LOADED', 'Load the `review-evidence` Skill and support each finding with source lines.', '',
].join('\n'))
await mkdir(join(userSkillsRoot, 'review-evidence'), { recursive: true })
await writeFile(join(userSkillsRoot, 'review-evidence', 'SKILL.md'), [
  '---', 'name: review-evidence', 'description: User evidence guidance for the fixture.', '---',
  '', 'USER EVIDENCE SKILL LOADED', '',
].join('\n'))
await writeFile(join(cwd, 'repository-source-before.json'), await snapshotRepository(repositoryRoot))

const ctx = await bootProductionProfile({
  binName: 'code-review-loader-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
const parentSessionId = SessionId(`code-review-parent-${randomUUID()}`)
interface ReviewerRun {
  readonly sessionId: string
  readonly runId: string
  readonly cwd: string
  readonly mode: 'complete' | 'deny-tools'
  readonly tools: string[]
  readonly attemptedTools: string[]
  readonly deniedTools: string[]
  readonly skillSources: string[]
}
const reviewerRuns: ReviewerRun[] = []
const reviewerSessions = new Map<string, import('@deepseek-ai/dsh-session').Session>()
let activeReviewer: ReviewerRun | undefined
let nextReviewerMode: ReviewerRun['mode'] = 'complete'
let staleStateInjected = false
let parentOutput = ''
let repositoryEvidence: { root: string; branch: string; head: string; changedDuringReview: boolean } | undefined
const adapter = new MockAdapter(Array.from({ length: 12 }, () => dispatch))
ctx.llm.registerAdapter(['fixture'], adapter)
const parent = await ctx.agentLoop.create(parentSessionId, { provider: 'fixture', model: 'fixture' }, { cwd: repositoryRoot })
const standardPreset = await ctx.agentPresets.resolve('standard')
if (standardPreset.broken !== undefined) throw new Error(`standard preset failed: ${standardPreset.broken}`)
await ctx.agentPresets.select(parent, 'standard')
const stopAttribution = ctx.on('subagent/start', ({ id, runId }) => {
  const child = ctx.agents.get(id)
  if (child === undefined) return
  const run: ReviewerRun = {
    sessionId: String(child.session.id),
    runId: String(runId),
    cwd: ctx.workingDirectory.get(child.session),
    mode: nextReviewerMode,
    tools: [],
    attemptedTools: [],
    deniedTools: [],
    skillSources: [],
  }
  reviewerRuns.push(run)
  activeReviewer = run
  reviewerSessions.set(run.sessionId, child.session)
})

try {
  const execution = await ctx.commands.execute(parent, '/review', [], new AbortController().signal)
  if (execution === undefined) throw new Error('/review was not registered on the standard Agent preset')
  if (execution.result.kind !== 'success') {
    const failures = [...reviewerSessions].map(([sessionId, session]) => ({
      sessionId,
      errors: session.snapshotEvents().flatMap(event => (
        event.type === 'turn/end' && event.data.reason.kind === 'error' ? [event.data.reason.error.message] : []
      )),
    }))
    throw new Error(`${execution.result.text}\nreviewer runs: ${JSON.stringify(reviewerRuns)}\nreviewer errors: ${JSON.stringify(failures)}`)
  }
  await parent.whenIdle()
  parentOutput = parent.session.snapshotEvents()
    .filter(event => event.type === 'assistant/message')
    .flatMap(event => event.data.message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .at(-1) ?? ''
  const handoff = adapter.requests
    .filter(request => String(request.sessionId) === String(parentSessionId))
    .flatMap(request => request.messages)
    .filter(message => message.role === 'user')
    .flatMap(message => message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .find(text => text.startsWith('[DSH code review handoff]'))
  if (handoff === undefined) throw new Error('parent model did not receive the repository review handoff')
  const branch = await git(repositoryRoot, ['branch', '--show-current'])
  const head = await git(repositoryRoot, ['rev-parse', 'HEAD'])
  repositoryEvidence = { root: repositoryRoot, branch, head, changedDuringReview: handoff.includes('Working tree changed during review: yes') }
  await writeFile(join(repositoryRoot, 'src', 'core.ts'), 'export const value = "working"\n')
  nextReviewerMode = 'deny-tools'
  const deniedExecution = await ctx.commands.execute(parent, '/review verify read-only tool restriction', [], new AbortController().signal)
  if (deniedExecution === undefined) throw new Error('/review registration disappeared before the denial control')
  const deniedRun = activeReviewer
  if (deniedRun === undefined) throw new Error('read-only denial control did not start a reviewer')
  const deniedSession = reviewerSessions.get(deniedRun.sessionId)
  if (deniedSession === undefined) throw new Error('read-only denial control lost the reviewer Session')
  for (const event of deniedSession.snapshotEvents()) {
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message.content) {
      if (block.type !== 'text') continue
      for (const name of forbiddenToolNames) {
        if (block.text.includes(`unknown tool "${name}"`) && !deniedRun.deniedTools.includes(name)) deniedRun.deniedTools.push(name)
      }
    }
  }
  process.stdout.write(`CODE_REVIEW_RESULT ${JSON.stringify({
    parentOutput,
    commandResult: execution.result,
    deniedCommandResult: deniedExecution.result,
    parentSessionId: String(parentSessionId),
    repository: repositoryEvidence,
    reviewerRuns,
  })}\n`)
} finally {
  stopAttribution()
  await ctx.fiber.dispose()
}

function dispatch(request: GenerateOptions): StreamChunk[] {
  if (String(request.sessionId) === String(parentSessionId)) {
    const transcript = JSON.stringify(request.messages)
    if (!transcript.includes('Review handoff guidance: attribute each finding')) {
      throw new Error('evidence hook did not add its advisory context to the parent turn')
    }
    const handoff = request.messages.flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .find(text => text.startsWith('[DSH code review handoff]'))
    if (handoff === undefined || !handoff.includes('Reviewer Session:') || !handoff.includes('Reviewer run:')) {
      throw new Error('parent turn omitted reviewer Session or run attribution')
    }
    return textResponse(`Repository: ${repositoryRoot}\nCommitted HEAD: ${handoff.match(/Committed HEAD: ([a-f0-9]+)/u)?.[1]}\nWorking tree changed during review: ${handoff.includes('Working tree changed during review: yes') ? 'yes' : 'no'}\n${transcript.includes('PROJECT REVIEW SKILL LOADED') ? 'PROJECT REVIEW SKILL LOADED' : ''}\n${transcript.includes('USER EVIDENCE SKILL LOADED') ? 'USER EVIDENCE SKILL LOADED' : ''}`)
  }

  const reviewer = activeReviewer
  if (reviewer === undefined) throw new Error('reviewer request has no originating subagent run')
  const tools = (request.tools ?? []).map(tool => tool.name)
  const transcript = JSON.stringify(request.messages)
  if (reviewer.tools.length === 0) {
    reviewer.tools.push(...tools)
    if (tools.length !== 1 || tools[0] !== 'skill') throw new Error(`reviewer received unexpected tools: ${tools.join(', ')}`)
    const promptText = request.messages.flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    const requiredEvidence = [
      '### Repository instructions: AGENTS.md',
      '### Repository instructions: src/AGENTS.md',
      '### Staged diff: src/core.ts',
      'value = "staged"',
      '### Unstaged diff: src/core.ts',
      'value = "working"',
      '### Untracked file: src/draft.ts',
      'draft = "untracked"',
      'binary or non-regular untracked files omitted: 2',
    ]
    const missingEvidence = requiredEvidence.filter(evidence => !promptText.includes(evidence))
    if (missingEvidence.length > 0) {
      throw new Error(`review packet omitted expected states: ${missingEvidence.join(', ')}`)
    }
    return toolCallResponse(`load-project-${randomUUID()}`, 'skill', { name: 'code-review' })
  }
  if (transcript.includes('fixture secret') || transcript.includes('ignored content')
    || transcript.includes('ignored CLAUDE content') || transcript.includes('changed-secret')) {
    throw new Error('ignored or secret-named file content reached the reviewer')
  }
  if (reviewer.skillSources.length === 0) {
    if (!transcript.includes('PROJECT REVIEW SKILL LOADED')) throw new Error('project Skill did not override the bundled review Skill')
    reviewer.skillSources.push('project')
    return toolCallResponse(`load-user-${randomUUID()}`, 'skill', { name: 'review-evidence' })
  }
  if (reviewer.skillSources.length === 1) {
    if (!transcript.includes('USER EVIDENCE SKILL LOADED')) throw new Error('user Skill was not found in the user configuration root')
    reviewer.skillSources.push('user')
  }
  if (reviewer.mode === 'deny-tools' && reviewer.attemptedTools.length === 0) {
    reviewer.attemptedTools.push(...forbiddenToolNames)
    return toolCallsResponse(forbiddenToolNames.map(name => ({
      id: `unauthorized-${name}-${randomUUID()}`,
      name,
      arguments: name === 'bash'
        ? { command: `echo unauthorized > "${join(repositoryRoot, 'unauthorized-shell.txt')}"` }
        : name === 'pwsh'
          ? { command: `Set-Content '${join(repositoryRoot, 'unauthorized-pwsh.txt')}' unauthorized` }
          : name === 'write'
            ? { file_path: join(repositoryRoot, 'unauthorized-write.txt'), content: 'unauthorized' }
            : name === 'edit'
              ? { file_path: join(repositoryRoot, 'src/core.ts'), old_string: 'working', new_string: 'unauthorized' }
              : name === 'apply_patch'
                ? { input: 'unauthorized patch' }
                : { mode: 'workspace-write', description: 'request wider execution' },
    })))
  }
  const errors = request.messages.filter(message => message.role === 'tool').map(message => JSON.stringify(message))
  if (!forbiddenToolNames.every(name => errors.some(result => result.includes(`unknown tool "${name}"`)))) {
    if (reviewer.mode === 'deny-tools') throw new Error('unavailable shell and filesystem tools were not rejected')
  }
  for (const name of forbiddenToolNames) {
    if (errors.some(result => result.includes(`unknown tool "${name}"`))
      && !reviewer.deniedTools.includes(name)) reviewer.deniedTools.push(name)
  }
  if (reviewer.mode === 'complete' && !staleStateInjected) {
    staleStateInjected = true
    writeFileSync(join(repositoryRoot, 'src', 'core.ts'), 'export const value = "changed during review"\n')
  }
  return textResponse('PROJECT REVIEW SKILL LOADED; USER EVIDENCE SKILL LOADED. Finding: src/core.ts:1 has staged and working-tree values that differ; preserve each value in the final report.')
}

function toolCallsResponse(calls: readonly { readonly id: string; readonly name: string; readonly arguments: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const argumentsJson = JSON.stringify(call.arguments)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: argumentsJson },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: argumentsJson } },
    )
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: calls.length * 5 } })
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

async function initializeRepository(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'AGENTS.md'), 'Follow the repository-local review rules.\n')
  await writeFile(join(root, 'CLAUDE.md'), 'ignored CLAUDE content; must not reach the reviewer\n')
  await writeFile(join(root, '.gitignore'), '.env\nignored.log\nCLAUDE.md\n')
  await writeFile(join(root, '.env'), 'fixture secret; must not reach the reviewer\n')
  await writeFile(join(root, 'ignored.log'), 'ignored content; must not reach the reviewer\n')
  await writeFile(join(root, 'src', 'AGENTS.md'), 'Source-specific repository review instructions.\n')
  await writeFile(join(root, 'src', 'core.ts'), 'export const value = "committed"\n')
  await writeFile(join(root, 'src', 'secrets.ts'), 'export const token = "fixture-secret"\n')
  await writeFile(join(root, 'src', 'credentials.json'), 'fixture secret; excluded\n')
  await writeFile(join(root, 'src', 'id_ed25519'), 'fixture secret; excluded\n')
  await writeFile(join(root, 'src', 'signing.p12'), 'fixture secret; excluded\n')
  await git(root, ['init', '--initial-branch', 'review-priority-two'])
  await git(root, ['add', '--', 'AGENTS.md', '.gitignore', 'src/AGENTS.md', 'src/core.ts', 'src/secrets.ts'])
  await git(root, ['-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial'])
  await writeFile(join(root, 'src', 'core.ts'), 'export const value = "staged"\n')
  await git(root, ['add', '--', 'src/core.ts'])
  await writeFile(join(root, 'src', 'core.ts'), 'export const value = "working"\n')
  await writeFile(join(root, 'src', 'draft.ts'), 'export const draft = "untracked"\n')
  await writeFile(join(root, 'src', 'blob.bin'), Uint8Array.from([0, 255, 13, 10]))
  await writeFile(join(root, 'src', 'invalid-utf8.bin'), Uint8Array.from([0xFF, 0xFE]))
  await writeFile(join(root, 'src', 'secrets.ts'), 'export const token = "changed-secret"\n')
}

async function snapshotRepository(root: string): Promise<string> {
  const paths = [
    'AGENTS.md', 'CLAUDE.md', '.gitignore', '.env', 'ignored.log', 'src/AGENTS.md', 'src/core.ts', 'src/draft.ts',
    'src/blob.bin', 'src/invalid-utf8.bin', 'src/secrets.ts', 'src/credentials.json', 'src/id_ed25519', 'src/signing.p12',
    '.agents/skills/code-review/SKILL.md',
  ]
  const files = await Promise.all(paths.map(async (path) => {
    try {
      return [path, (await readFile(join(root, path))).toString('base64')] as const
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [path, null] as const
      throw error
    }
  }))
  const index = await readFile(join(root, '.git', 'index'))
  return JSON.stringify({
    files,
    index: index.toString('base64'),
    branch: await git(root, ['branch', '--show-current']),
    head: await git(root, ['rev-parse', 'HEAD']),
    status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
  })
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
