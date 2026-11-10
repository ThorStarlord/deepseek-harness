import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import type { SandboxEnforcement } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import Subagents from '@deepseek-ai/dsh-subagent'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService, { setApprovalPolicy, type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import * as ToolMultiRepository from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const execFileAsync = promisify(execFile)
const thirdFileFromBash = 'third-write-from-bash.txt'
const thirdFileFromFs = 'third-write-from-fs.txt'
const workspaceFile = 'worker-output.txt'

interface Fixture {
  readonly ctx: Context
  readonly root: string
  readonly dshHome: string
  readonly alpha: Workspace
  readonly beta: Workspace
  readonly third: Workspace
  readonly alphaHead: string
  readonly betaHead: string
  readonly fullEnforcement: boolean
  readonly enforcement: SandboxEnforcement | 'unavailable'
  readonly parentId: SessionId
  readonly parent: Agent
}

interface SetupOptions {
  /** Report full enforcement to exercise orchestration paths without qualifying isolation. */
  readonly simulateWorkspaceWrites?: boolean
  /** Attempt writes to the third repository only in the real-enforcement scenario. */
  readonly attemptUnselectedWrites?: boolean
  /** Hang both child model requests so parent cancellation exercises child disposal. */
  readonly hangChildren?: boolean
  /** Choose model-authored repository roots for selection validation cases. */
  readonly modelRepositories?: (paths: {
    readonly alpha: string
    readonly beta: string
    readonly third: string
    readonly parent: string
  }) => readonly [string, string]
  /** Select a named provider to cover unavailable scoped delegation. */
  readonly providerName?: string
  /** Add a deployment-wide write grant that repository runs must reject. */
  readonly additionalWritableRoot?: boolean
}

let fixture: Fixture | undefined
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  fixture = undefined
}, 30_000)

async function setup(options: SetupOptions = {}): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(homedir(), '.dsh-multi-repository-')))
  roots.push(root)
  const dshHome = join(root, 'dsh-home')
  const workspaceRoot = join(root, 'workspaces')
  const parentCwd = join(root, 'parent')
  const alphaPath = join(workspaceRoot, 'alpha')
  const betaPath = join(workspaceRoot, 'beta')
  const thirdPath = join(workspaceRoot, 'unselected-third')
  await Promise.all([dshHome, parentCwd, alphaPath, betaPath, thirdPath].map(path => mkdir(path, { recursive: true })))
  vi.stubEnv('DSH_HOME', dshHome)
  const alphaHead = await initializeRepository(alphaPath, 'Alpha repository instructions: ALPHA ONLY.')
  const betaHead = await initializeRepository(betaPath, 'Beta repository instructions: BETA ONLY.')
  await initializeRepository(thirdPath, 'Third repository is not selected.')

  const alpha = workspaceRecord('workspace-alpha', 'Alpha repo', alphaPath)
  const beta = workspaceRecord('workspace-beta', 'Beta repo', betaPath)
  const third = workspaceRecord('workspace-third', 'Unselected third repo', thirdPath)
  const modelRepositories = options.modelRepositories?.({
    alpha: alphaPath, beta: betaPath, third: thirdPath, parent: parentCwd,
  }) ?? [alphaPath, betaPath]
  const parentId = SessionId(`multi-repository-parent-${randomUUID()}`)
  let fullEnforcement = false
  let enforcement: SandboxEnforcement | 'unavailable' = 'unavailable'
  const attemptUnselectedWrites = options.attemptUnselectedWrites ?? true

  const handler = (options: GenerateOptions): StreamChunk[] => {
    if (options.sessionId === parentId) {
      const calls = toolCalls(options)
      if (calls.length === 0) {
        return toolCallResponse('coordinate-two-repositories', 'coordinate_repositories', {
          repositories: modelRepositories,
          task: 'Read this repository’s instructions and write a short result file for this repository.',
        })
      }
      if (JSON.stringify(options.messages).includes('startup-error')) {
        return textResponse('Alpha repo and Beta repo could not start their repository workers.')
      }
      if (fullEnforcement && attemptUnselectedWrites) {
        const transcript = JSON.stringify(options.messages)
        if (!transcript.includes('Alpha repo') || !transcript.includes('Beta repo')
          || !transcript.includes(alphaHead) || !transcript.includes(betaHead)
          || !transcript.includes(thirdFileFromBash) || !transcript.includes(thirdFileFromFs)) {
          return textResponse('Repository coordination did not return both attributed repository results and their Git evidence.')
        }
        return textResponse('Alpha repo and Beta repo completed in separate clones; both unselected-repository writes were denied.')
      }
      if (fullEnforcement) {
        const transcript = JSON.stringify(options.messages)
        if (!transcript.includes('Alpha repo') || !transcript.includes('Beta repo')
          || !transcript.includes(alphaHead) || !transcript.includes(betaHead)) {
          return textResponse('Repository coordination did not return both attributed repository results and their Git evidence.')
        }
        return textResponse('Alpha repo and Beta repo completed in separate clones.')
      }
      return textResponse('Repository coordination stopped because full write enforcement was unavailable.')
    }

    const calls = toolCalls(options)
    const transcript = JSON.stringify(options.messages)
    const alphaChild = transcript.includes('Alpha repo')
    const repoLabel = alphaChild ? 'Alpha repo' : 'Beta repo'
    const ownInstruction = alphaChild ? 'ALPHA ONLY' : 'BETA ONLY'
    if (calls.length === 0) return toolCallResponse('read-repository-instructions', 'read', { file_path: 'AGENTS.md' })
    if (calls.length === 1) {
      if (!transcript.includes(ownInstruction) || transcript.includes(alphaChild ? 'BETA ONLY' : 'ALPHA ONLY')) {
        throw new Error(`${repoLabel} child did not read only its own repository instructions`)
      }
      if (!attemptUnselectedWrites) return textResponse(`${repoLabel} completed its repository-scoped activation.`)
      return toolCallResponse('write-selected-clone', 'bash', {
        description: `Write the selected ${repoLabel} clone.`,
        command: `printf '%s' ${shellQuote(`${repoLabel} result`)} > ${shellQuote(workspaceFile)}`,
      })
    }
    if (calls.length === 2) {
      return toolCallResponse('attempt-third-repository-shell-write', 'bash', {
        description: 'Attempt a write to the unselected third repository.',
        command: `printf forbidden > ${shellQuote(join(thirdPath, thirdFileFromBash))}`,
      })
    }
    if (calls.length === 3) {
      return toolCallResponse('attempt-third-repository-filesystem-write', 'write', {
        file_path: join(thirdPath, thirdFileFromFs),
        content: 'forbidden',
      })
    }
    if (!transcript.toLowerCase().includes('denied') && !transcript.toLowerCase().includes('sandbox')) {
      throw new Error(`${repoLabel} child did not receive a denial for both third-repository writes`)
    }
    return textResponse(
      `${repoLabel} wrote its selected clone; ${thirdFileFromBash} and ${thirdFileFromFs} writes to the third repository were denied.`,
    )
  }

  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(Sandbox)
  await ctx.plugin(SandboxPolicy, {
    mode: 'workspace-write',
    workspaceRoot: parentCwd,
    additionalWritableRoots: options.additionalWritableRoot === true ? [parentCwd] : [],
  })
  await ctx.plugin(SandboxedFileSystem, { cwd: parentCwd })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(ShellEnv)
  await ctx.plugin(SandboxBashExecutor, { cwd: parentCwd, timeoutMs: 30_000 })
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolFs)
  ctx.provide('workspaceRegistry', { list: () => [alpha, beta, third] } as never)
  await ctx.plugin(ToolMultiRepository, { providerName: options.providerName ?? 'spawn' })
  const script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]) | 'hang')[]
    = Array.from({ length: 20 }, () => handler)
  if (options.hangChildren === true) {
    script[1] = 'hang'
    script[2] = 'hang'
  }
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  ctx.llm.registerAdapter(['single'], new MockAdapter([textResponse('ordinary single-repository child completed')]))

  try {
    enforcement = (await ctx.sandbox.confine(['git', '--version'], {
      mode: 'workspace-write',
      workspaceRoot: alphaPath,
    })).enforcement
    fullEnforcement = enforcement === 'full'
  } catch {
    enforcement = 'unavailable'
  }
  if (options.simulateWorkspaceWrites) {
    // This controlled path exercises orchestration only and never attempts an unselected write.
    ctx.sandbox.confine = async argv => ({
      argv: [...argv],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [],
    })
    fullEnforcement = true
  }

  const parent = await ctx.agentLoop.create(parentId, { provider: 'mock', model: 'mock' }, { cwd: parentCwd })
  return { ctx, root, dshHome, alpha, beta, third, alphaHead, betaHead, fullEnforcement, enforcement, parentId, parent }
}

function workspaceRecord(id: string, title: string, path: string): Workspace {
  return { id: WorkspaceId(id), title, path } as never
}

async function initializeRepository(path: string, instructions: string): Promise<string> {
  await writeFile(join(path, 'AGENTS.md'), `${instructions}\n`)
  await writeFile(join(path, 'baseline.txt'), `${instructions}\n`)
  const git = async (...args: string[]): Promise<string> => {
    const windows = process.platform === 'win32'
    const env = gitTestEnvironment(windows)
    const result = await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd: path, env })
    return result.stdout
  }
  await git('init', '-b', 'main')
  await git('add', '--', 'AGENTS.md', 'baseline.txt')
  await git('-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial state')
  return (await git('rev-parse', 'HEAD')).trim()
}

async function gitAt(cwd: string, ...args: string[]): Promise<string> {
  const windows = process.platform === 'win32'
  const env = gitTestEnvironment(windows)
  const result = await execFileAsync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, ...args], { cwd, env })
  return result.stdout
}

function gitTestEnvironment(windows: boolean): NodeJS.ProcessEnv {
  const inheritedGitVariables = new Set([
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ])
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('GIT_CONFIG_') && !inheritedGitVariables.has(name)) env[name] = value
  }
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = windows ? 'NUL' : '/dev/null'
  env.GIT_NO_REPLACE_OBJECTS = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function toolCalls(options: GenerateOptions): string[] {
  return options.messages.flatMap(message => message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []))
}

function answerRepositoryAuthorization(
  ctx: Context,
  outcome: ApprovalOutcome,
  onRequest?: (request: ApprovalRequestEvent) => void,
): void {
  ctx.on('approval/request', (request) => {
    if (request.toolName !== 'coordinate_repositories') return Promise.resolve('unavailable')
    onRequest?.(request)
    return Promise.resolve(outcome)
  })
}

function stringField(record: Record<string, JsonValue>, name: string): string {
  const value = record[name]
  if (typeof value !== 'string') throw new Error(`repository result is missing ${name}`)
  return value
}

function repositoryRows(value: JsonValue | undefined): Record<string, JsonValue>[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.repositories)) {
    throw new Error('multi-repository tool result did not contain repository rows')
  }
  return value.repositories.flatMap(row => row !== null && typeof row === 'object' && !Array.isArray(row) ? [row] : [])
}

async function runParentTurn(parent: Agent): Promise<void> {
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Implement this related coding task in Alpha repo and Beta repo.' }],
    source: { kind: 'user' },
  }))
  await parent.whenIdle()
}

describe('multi-repository workflow', () => {
  it('rejects malformed model arguments at the pre-execution gate', async () => {
    fixture = await setup()
    const malformed: unknown[] = [
      null,
      [],
      {},
      { repositories: [] },
      { repositories: [fixture.alpha.path] },
      { repositories: [fixture.alpha.path, fixture.beta.path] },
      { repositories: [fixture.alpha.path, fixture.beta.path], task: 3 },
      { repositories: [fixture.alpha.path, 3], task: 'task' },
    ]
    for (const [index, args] of malformed.entries()) {
      const decision = await fixture.ctx.waterfall('tools/pre-execute', {
        callId: ToolCallId(`invalid-repository-call-${index}`),
        name: 'coordinate_repositories',
        arguments: args,
        agent: fixture.parent,
        signal: new AbortController().signal,
      } as never, () => Promise.resolve({ kind: 'allow' } as never))
      expect(decision).toMatchObject({ kind: 'deny' })
    }
    const unrelated = await fixture.ctx.waterfall('tools/pre-execute', {
      callId: ToolCallId('unrelated-call'),
      name: 'other_tool',
      arguments: {},
      agent: fixture.parent,
      signal: new AbortController().signal,
    } as never, () => Promise.resolve({ kind: 'allow' } as never))
    expect(unrelated).toMatchObject({ kind: 'allow' })
  })

  it('fails closed when an earlier tool policy bypasses repository authorization', async () => {
    fixture = await setup()
    const tool = fixture.ctx.tools.get('coordinate_repositories')
    expect(tool).toBeDefined()
    await expect(tool!.execute({
      repositories: [fixture.alpha.path, fixture.beta.path],
      task: 'write one result per repository',
    }, {
      callId: ToolCallId('unapproved-direct-call'),
      agent: fixture.parent,
      signal: new AbortController().signal,
    } as never)).rejects.toMatchObject({ code: 'WRITE_AUTHORIZATION_REQUIRED' })
    expect(await readdir(fixture.dshHome)).toEqual([])
  })

  it('renders repository evidence and projects ownership metadata for valid and incomplete rows', async () => {
    fixture = await setup()
    const tool = fixture.ctx.tools.get('coordinate_repositories')
    const required = {
      workspaceTitle: 'Alpha repo',
      workspaceId: 'workspace-alpha',
      sourceRoot: fixture.alpha.path,
      sourceGitIdentity: join(fixture.alpha.path, '.git'),
      sourceHead: fixture.alphaHead,
      sourceBranch: null,
      execution: 'startup-error',
      stopReason: 'startup-error',
      finalHead: null,
      gitStatus: null,
      diffStat: '',
      cloneRoot: join(fixture.dshHome, 'alpha-clone'),
      childBranch: 'dsh-run-alpha',
      setupEnforcement: 'full',
      assistantOutput: 'child did not start',
    } satisfies JsonValue
    const complete = {
      ...required,
      workspaceTitle: 'Beta repo',
      workspaceId: 'workspace-beta',
      sourceRoot: fixture.beta.path,
      sourceGitIdentity: join(fixture.beta.path, '.git'),
      sourceHead: fixture.betaHead,
      sourceBranch: 'main',
      execution: 'result',
      stopReason: 'final',
      finalHead: fixture.betaHead,
      gitStatus: '## dsh-run-beta',
      diffStat: ' worker-output.txt | 1 +',
      cloneRoot: join(fixture.dshHome, 'beta-clone'),
      childBranch: 'dsh-run-beta',
      assistantOutput: 'Beta completed.',
      childSessionId: 'child-beta',
      runId: 'run-beta',
    } satisfies JsonValue
    const value: JsonValue = { repositories: [null, [], { workspaceTitle: 3 }, required, complete] }

    expect(tool?.output.render({}, null)).toEqual([{ type: 'text', text: '' }])
    expect(tool?.output.render({}, { repositories: 'invalid' })).toEqual([{ type: 'text', text: '' }])
    expect(tool?.output.render({}, value)).toEqual([{
      type: 'text',
      text: [
        `Alpha repo (${fixture.alpha.path}; Git ${join(fixture.alpha.path, '.git')}; source branch unavailable) — startup-error; Session not started, run not started, startup-error; base ${fixture.alphaHead}; final unavailable; worktree status "unavailable"; tracked diff none; clone ${join(fixture.dshHome, 'alpha-clone')} (dsh-run-alpha); sandbox full; child report child did not start`,
        `Beta repo (${fixture.beta.path}; Git ${join(fixture.beta.path, '.git')}; source branch main) — result; Session child-beta, run run-beta, final; base ${fixture.betaHead}; final ${fixture.betaHead}; worktree status "## dsh-run-beta"; tracked diff  worker-output.txt | 1 +; clone ${join(fixture.dshHome, 'beta-clone')} (dsh-run-beta); sandbox full; child report Beta completed.`,
      ].join('\n'),
    }])
    expect(tool?.output.presentationMeta?.({}, value)).toEqual({ repositories: [
      {
        workspaceId: 'workspace-alpha', sourceRoot: fixture.alpha.path,
        cloneRoot: join(fixture.dshHome, 'alpha-clone'), childBranch: 'dsh-run-alpha',
        execution: 'startup-error', stopReason: 'startup-error',
      },
      {
        workspaceId: 'workspace-beta', sourceRoot: fixture.beta.path,
        cloneRoot: join(fixture.dshHome, 'beta-clone'), childBranch: 'dsh-run-beta',
        execution: 'result', stopReason: 'final', childSessionId: 'child-beta', runId: 'run-beta',
      },
    ] })
    expect(tool?.output.presentationMeta?.({}, 'invalid')).toEqual({ repositories: [] })
  })

  it('coordinates two repositories with separate child Sessions and denies an unselected third repository', async ({ skip }) => {
    fixture = await setup()
    if (!fixture.fullEnforcement) skip()
    setSandboxMode(fixture.parent.session, 'read-only')
    let approvalRequest: ApprovalRequestEvent | undefined
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once', (request) => { approvalRequest = request })
    const started: string[] = []
    const lifecycle: { readonly type: 'start' | 'end'; readonly id: string; readonly runId: string }[] = []
    fixture.ctx.on('subagent/start', ({ id, runId }) => {
      started.push(String(id))
      lifecycle.push({ type: 'start', id: String(id), runId: String(runId) })
    })
    fixture.ctx.on('subagent/end', ({ id, runId }) => {
      lifecycle.push({ type: 'end', id: String(id), runId: String(runId) })
    })
    await runParentTurn(fixture.parent)

    const events = fixture.parent.session.snapshotEvents()
    const coordination = events.find((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.meta !== undefined,
    )
    expect(coordination?.data.message.isError).toBe(false)
    expect(fixture.ctx.sandboxPolicy.overrideOf(fixture.parent.session)).toBe('read-only')
    expect(approvalRequest?.reason).toContain(JSON.stringify(fixture.alpha.path))
    expect(approvalRequest?.reason).toContain(JSON.stringify(fixture.beta.path))
    expect(approvalRequest?.reason).toContain('Read this repository’s instructions and write a short result file for this repository.')
    expect(approvalRequest?.displayReason?.en).toContain(fixture.alpha.path)
    expect(approvalRequest?.displayReason?.en).toContain(fixture.beta.path)
    expect(approvalRequest?.displayReason?.en).toContain('Read this repository’s instructions and write a short result file for this repository.')
    const approvalAsked = events.find((event): event is SessionEvent<'approval/asked'> => event.type === 'approval/asked')
    const approvalDecided = events.find((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')
    expect(approvalAsked?.data).toMatchObject({ toolName: 'coordinate_repositories', reason: approvalRequest?.reason })
    expect(approvalAsked?.data.callId).toBeDefined()
    expect(approvalDecided?.data).toMatchObject({ id: approvalAsked?.data.id, outcome: 'allowed-once' })
    const rows = repositoryRows(coordination?.data.meta)
    expect(rows).toHaveLength(2)
    expect(started).toHaveLength(2)

    const output = coordination!.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(output).toContain(fixture.alphaHead)
    expect(output).toContain(fixture.betaHead)
    expect(output).toContain(fixture.alpha.path)
    expect(output).toContain(fixture.beta.path)
    expect(output).toContain(thirdFileFromBash)
    expect(output).toContain(thirdFileFromFs)
    expect(output).toContain('?? worker-output.txt')

    const alphaRow = rows[0]!
    const betaRow = rows[1]!
    expect(stringField(alphaRow, 'workspaceId')).toBe(String(fixture.alpha.id))
    expect(stringField(betaRow, 'workspaceId')).toBe(String(fixture.beta.id))
    expect(stringField(alphaRow, 'sourceRoot')).toBe(fixture.alpha.path)
    expect(stringField(betaRow, 'sourceRoot')).toBe(fixture.beta.path)
    expect(output).toContain(`Git ${join(fixture.alpha.path, '.git')}`)
    expect(output).toContain(`Git ${join(fixture.beta.path, '.git')}`)
    expect(output).toContain('source branch main')
    expect(output).toContain(`base ${fixture.alphaHead}`)
    expect(output).toContain(`base ${fixture.betaHead}`)
    const alphaSessionId = SessionId(stringField(alphaRow, 'childSessionId'))
    const betaSessionId = SessionId(stringField(betaRow, 'childSessionId'))
    const alphaRunId = stringField(alphaRow, 'runId')
    const betaRunId = stringField(betaRow, 'runId')
    expect(alphaSessionId).not.toBe(betaSessionId)
    expect(alphaRunId).not.toBe(betaRunId)

    const alphaSession = fixture.ctx.sessions.get(alphaSessionId)
    const betaSession = fixture.ctx.sessions.get(betaSessionId)
    expect(alphaSession?.header.cwd).toBe(stringField(alphaRow, 'cloneRoot'))
    expect(betaSession?.header.cwd).toBe(stringField(betaRow, 'cloneRoot'))
    expect(alphaSession?.header.parentSession).toBe(fixture.parentId)
    expect(betaSession?.header.parentSession).toBe(fixture.parentId)
    expect(lifecycle).toContainEqual({ type: 'start', id: String(alphaSessionId), runId: alphaRunId })
    expect(lifecycle).toContainEqual({ type: 'end', id: String(alphaSessionId), runId: alphaRunId })
    expect(lifecycle).toContainEqual({ type: 'start', id: String(betaSessionId), runId: betaRunId })
    expect(lifecycle).toContainEqual({ type: 'end', id: String(betaSessionId), runId: betaRunId })

    for (const [session, ownMarker, otherMarker] of [
      [alphaSession, 'ALPHA ONLY', 'BETA ONLY'],
      [betaSession, 'BETA ONLY', 'ALPHA ONLY'],
    ] as const) {
      expect(session).toBeDefined()
      const toolResults = session!.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
      const toolText = toolResults.flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
      expect(toolText).toContain(ownMarker)
      expect(toolText).not.toContain(otherMarker)
      expect(toolResults.filter(event => event.data.message.isError)).toHaveLength(2)
      expect(session!.snapshotEvents().some(event => event.type === 'sandbox/mode'
        && event.data.mode === 'workspace-write' && event.data.source === 'delegation')).toBe(true)
      expect(session!.snapshotEvents().some(event => event.type === 'permission/preset')).toBe(false)
    }

    expect(await readFile(join(stringField(alphaRow, 'cloneRoot'), workspaceFile), 'utf8')).toBe('Alpha repo result')
    expect(await readFile(join(stringField(betaRow, 'cloneRoot'), workspaceFile), 'utf8')).toBe('Beta repo result')
    await expect(readFile(join(fixture.third.path, thirdFileFromBash), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(fixture.third.path, thirdFileFromFs), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await gitAt(fixture.alpha.path, 'status', '--porcelain')).toBe('')
    expect(await gitAt(fixture.beta.path, 'status', '--porcelain')).toBe('')

    const parentOutput = events
      .filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
      .flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .at(-1)
    expect(parentOutput).toContain('Alpha repo and Beta repo completed')
    expect((await readdir(fixture.dshHome)).length).toBe(2)
  })

  it('collects separate repository results when enforcement is simulated, without qualifying write isolation', async () => {
    fixture = await setup({ simulateWorkspaceWrites: true, attemptUnselectedWrites: false })
    setSandboxMode(fixture.parent.session, 'read-only')
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')
    const childSessions = new Map<string, Agent['session']>()
    fixture.ctx.on('subagent/start', ({ id }) => {
      const child = fixture!.ctx.agents.get(id)
      if (child !== undefined) childSessions.set(String(id), child.session)
    })
    await runParentTurn(fixture.parent)

    const events = fixture.parent.session.snapshotEvents()
    const coordination = events.find((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.meta !== undefined,
    )
    expect(coordination?.data.message.isError, JSON.stringify(events
      .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
      .map(event => ({ content: event.data.message.content, error: event.data.error }))))
      .toBe(false)
    expect(fixture.ctx.sandboxPolicy.overrideOf(fixture.parent.session)).toBe('read-only')
    const rows = repositoryRows(coordination?.data.meta)
    const output = coordination!.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(rows).toHaveLength(2)
    expect(stringField(rows[0]!, 'sourceRoot')).toBe(fixture.alpha.path)
    expect(stringField(rows[1]!, 'sourceRoot')).toBe(fixture.beta.path)
    expect(stringField(rows[0]!, 'workspaceId')).toBe(String(fixture.alpha.id))
    expect(stringField(rows[1]!, 'workspaceId')).toBe(String(fixture.beta.id))
    expect(output).toContain(`Git ${join(fixture.alpha.path, '.git')}`)
    expect(output).toContain(`Git ${join(fixture.beta.path, '.git')}`)
    expect(output).toContain('source branch main')
    expect(stringField(rows[0]!, 'cloneRoot')).not.toBe(fixture.alpha.path)
    expect(stringField(rows[1]!, 'cloneRoot')).not.toBe(fixture.beta.path)
    expect(stringField(rows[0]!, 'cloneRoot')).not.toBe(stringField(rows[1]!, 'cloneRoot'))
    expect(rows.map(row => stringField(row, 'execution')), output).toEqual(['result', 'result'])
    expect(childSessions.size).toBe(2)
    for (const row of rows) {
      const childSessionId = stringField(row, 'childSessionId')
      const childSession = childSessions.get(childSessionId)
      expect(childSession?.header.cwd).toBe(stringField(row, 'cloneRoot'))
      expect(childSession?.header.id).toBe(SessionId(childSessionId))
      expect(childSession?.header.parentSession).toBe(fixture.parentId)
      expect(stringField(row, 'runId')).toBeTruthy()
    }
    expect(output).toContain('Alpha repo')
    expect(output).toContain('Beta repo')
    expect(output).toContain(fixture.alphaHead)
    expect(output).toContain(fixture.betaHead)
    expect(output).toContain('final ')
    expect((await readdir(fixture.dshHome)).length).toBe(2)
  }, 30_000)

  it('stops both child Sessions when the parent conversation is cancelled', async () => {
    fixture = await setup({ simulateWorkspaceWrites: true, attemptUnselectedWrites: false, hangChildren: true })
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')
    const starts: { readonly id: string; readonly runId: string }[] = []
    const ends: { readonly id: string; readonly runId: string }[] = []
    const bothStarted = Promise.withResolvers<undefined>()
    fixture.ctx.on('subagent/start', ({ id, runId }) => {
      starts.push({ id: String(id), runId: String(runId) })
      if (starts.length === 2) bothStarted.resolve(undefined)
    })
    fixture.ctx.on('subagent/end', ({ id, runId }) => {
      ends.push({ id: String(id), runId: String(runId) })
    })
    const turn = runParentTurn(fixture.parent)
    await bothStarted.promise

    expect(await readdir(fixture.dshHome)).toHaveLength(2)
    fixture.parent.cancel({ kind: 'user' })
    await turn

    expect(ends).toHaveLength(2)
    expect(ends).toEqual(expect.arrayContaining(starts))
    expect(starts.every(({ id }) => fixture!.ctx.agents.get(SessionId(id)) === undefined)).toBe(true)
    expect(await readdir(fixture.dshHome)).toHaveLength(2)
    expect(await gitAt(fixture.alpha.path, 'status', '--porcelain')).toBe('')
    expect(await gitAt(fixture.beta.path, 'status', '--porcelain')).toBe('')
  }, 30_000)

  it('returns attributed startup errors when repository children cannot start', async () => {
    fixture = await setup({ simulateWorkspaceWrites: true, attemptUnselectedWrites: false })
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')
    vi.spyOn(fixture.ctx.subagents, 'startActivation').mockRejectedValue(new Error('provider startup failed'))
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })

    await runParentTurn(fixture.parent)

    const events = fixture.parent.session.snapshotEvents()
    const result = events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(result?.data.message.isError).toBe(false)
    const output = result?.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') ?? ''
    expect(output).toContain('Alpha repo')
    expect(output).toContain('Beta repo')
    expect(output).toContain('startup-error')
    expect(output).toContain('provider startup failed')
    expect(output).toContain('Session not started, run not started')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toHaveLength(2)
    expect(await gitAt(fixture.alpha.path, 'status', '--porcelain')).toBe('')
    expect(await gitAt(fixture.beta.path, 'status', '--porcelain')).toBe('')
  }, 30_000)

  it('returns attributed child execution errors with their Session and run identity', async () => {
    fixture = await setup({ simulateWorkspaceWrites: true, attemptUnselectedWrites: false })
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')
    let nextChild = 0
    vi.spyOn(fixture.ctx.subagents, 'startActivation').mockImplementation(() => {
      nextChild += 1
      return Promise.resolve({
        childId: SessionId(`failed-result-child-${nextChild}`),
        runId: SubagentRunId(`failed-result-run-${nextChild}`),
        name: `repo-failed-${nextChild}`,
        result: Promise.reject(new Error(`child ${nextChild} failed`)),
        dispose: () => Promise.resolve(),
      })
    })

    await runParentTurn(fixture.parent)

    const result = fixture.parent.session.snapshotEvents().find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    const output = result?.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') ?? ''
    expect(output).toContain('result-error')
    expect(output).toContain('execution-error')
    expect(output).toContain('child 1 failed')
    expect(output).toContain('Session failed-result-child-1, run failed-result-run-1')
    expect(output).toContain('child 2 failed')
    expect(output).toContain('Session failed-result-child-2, run failed-result-run-2')
    expect(await readdir(fixture.dshHome)).toHaveLength(2)
  }, 30_000)

  it('refuses clone setup before child startup when the selected sandbox reports partial enforcement', async ({ skip }) => {
    fixture = await setup()
    if (fixture.enforcement !== 'partial') skip()
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })
    await runParentTurn(fixture.parent)

    const failures = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.message.isError === true,
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]?.data.error?.code).toBe('SANDBOX_ENFORCEMENT_INCOMPLETE')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('refuses DSH_HOME inside an unselected Git repository before creating clones', async () => {
    fixture = await setup()
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')
    const thirdHome = join(fixture.third.path, '.dsh-home')
    await mkdir(thirdHome)
    vi.stubEnv('DSH_HOME', thirdHome)
    await runParentTurn(fixture.parent)

    const failures = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> =>
      event.type === 'tool/result' && event.data.message.isError === true,
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]?.data.error?.code).toBe('RUN_HOME_INSIDE_GIT_REPOSITORY')
    expect(await readdir(thirdHome)).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('rejects a deployment-wide writable root before creating repository clones', async () => {
    fixture = await setup({ additionalWritableRoot: true })
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')

    await runParentTurn(fixture.parent)

    const result = fixture.parent.session.snapshotEvents().find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(result?.data.error?.code).toBe('UNSCOPED_WRITABLE_ROOTS')
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('rejects a DSH_HOME inside the operating-system temporary directory', async () => {
    fixture = await setup()
    const temporaryHome = await realpath(await mkdtemp(join(tmpdir(), 'dsh-multi-repository-home-')))
    roots.push(temporaryHome)
    vi.stubEnv('DSH_HOME', temporaryHome)
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')

    await runParentTurn(fixture.parent)

    const result = fixture.parent.session.snapshotEvents().find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(result?.data.error?.code).toBe('RUN_HOME_INSIDE_TEMP')
    expect(await readdir(temporaryHome)).toEqual([])
  }, 30_000)

  it('rejects a registered unselected Workspace inside the temporary directory', async () => {
    fixture = await setup()
    const temporaryRepository = await realpath(await mkdtemp(join(tmpdir(), 'dsh-multi-repository-unselected-')))
    roots.push(temporaryRepository)
    await initializeRepository(temporaryRepository, 'Temporary repository instructions.')
    const registered = fixture.ctx.workspaceRegistry.list()
    vi.spyOn(fixture.ctx.workspaceRegistry, 'list').mockReturnValue([
      ...registered,
      workspaceRecord('workspace-temporary', 'Temporary repo', temporaryRepository),
    ])
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')

    await runParentTurn(fixture.parent)

    const result = fixture.parent.session.snapshotEvents().find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(result?.data.error?.code).toBe('UNSELECTED_WORKSPACE_INSIDE_TEMP')
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('rejects a selected repository inside the temporary directory', async ({ skip }) => {
    if (process.platform === 'win32') skip()
    const temporaryRepository = await realpath(await mkdtemp(join(tmpdir(), 'dsh-multi-repository-selected-')))
    roots.push(temporaryRepository)
    await initializeRepository(temporaryRepository, 'Temporary repository instructions.')
    fixture = await setup({ modelRepositories: paths => [temporaryRepository, paths.beta] })
    const registered = fixture.ctx.workspaceRegistry.list()
    vi.spyOn(fixture.ctx.workspaceRegistry, 'list').mockReturnValue([
      ...registered,
      workspaceRecord('workspace-temporary-selected', 'Temporary selected repo', temporaryRepository),
    ])
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')

    await runParentTurn(fixture.parent)

    const result = fixture.parent.session.snapshotEvents().find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(result?.data.error?.code, JSON.stringify(result?.data.message.content)).toBe('REPOSITORY_INSIDE_TEMP')
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('does not let a read-only parent delegate writes when approval policy is never', async () => {
    fixture = await setup()
    setSandboxMode(fixture.parent.session, 'read-only')
    setApprovalPolicy(fixture.parent.session, 'never')
    let consulted = false
    fixture.ctx.on('approval/request', () => {
      consulted = true
      return Promise.resolve('allowed-once' as const)
    })
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })

    await runParentTurn(fixture.parent)

    const events = fixture.parent.session.snapshotEvents()
    const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.isError).toBe(true)
    const deniedContent = results[0]?.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
    expect(deniedContent).toContain('rejected tool "coordinate_repositories"')
    expect(events.find((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')?.data.outcome).toBe('rejected')
    expect(consulted).toBe(false)
    expect(fixture.ctx.sandboxPolicy.overrideOf(fixture.parent.session)).toBe('read-only')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('does not treat registration as current-turn authorization for selected repositories', async () => {
    fixture = await setup()
    setSandboxMode(fixture.parent.session, 'read-only')
    let approvalRequest: ApprovalRequestEvent | undefined
    answerRepositoryAuthorization(fixture.ctx, 'rejected', (request) => { approvalRequest = request })
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })

    await runParentTurn(fixture.parent)

    const events = fixture.parent.session.snapshotEvents()
    const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.isError).toBe(true)
    expect(approvalRequest?.reason).toContain(JSON.stringify(fixture.alpha.path))
    expect(approvalRequest?.reason).toContain(JSON.stringify(fixture.beta.path))
    expect(approvalRequest?.reason).toContain('Read this repository’s instructions and write a short result file for this repository.')
    expect(approvalRequest?.displayReason?.en).toContain(fixture.alpha.path)
    expect(approvalRequest?.displayReason?.en).toContain(fixture.beta.path)
    expect(approvalRequest?.displayReason?.en).toContain('Read this repository’s instructions and write a short result file for this repository.')
    expect(events.find((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')?.data.outcome).toBe('rejected')
    expect(fixture.ctx.sandboxPolicy.overrideOf(fixture.parent.session)).toBe('read-only')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('denies an unregistered path before requesting write authorization', async () => {
    fixture = await setup({ modelRepositories: paths => [paths.parent, paths.beta] })
    let requestedApproval = false
    fixture.ctx.on('approval/request', () => {
      requestedApproval = true
      return Promise.resolve('allowed-once' as const)
    })

    await runParentTurn(fixture.parent)

    const results = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.isError).toBe(true)
    expect(results[0]?.data.error?.code).toBe('WORKSPACE_NOT_SELECTED')
    expect(requestedApproval).toBe(false)
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('denies selecting the same Git repository twice before requesting authorization', async () => {
    fixture = await setup({ modelRepositories: paths => [paths.alpha, paths.alpha] })
    let requestedApproval = false
    fixture.ctx.on('approval/request', () => {
      requestedApproval = true
      return Promise.resolve('allowed-once' as const)
    })

    await runParentTurn(fixture.parent)

    const results = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.isError).toBe(true)
    expect(results[0]?.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'))
      .toContain('same Git repository identity')
    expect(requestedApproval).toBe(false)
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('denies a dirty selected repository before requesting write authorization', async () => {
    fixture = await setup()
    await writeFile(join(fixture.alpha.path, 'uncommitted.txt'), 'dirty')
    let requestedApproval = false
    fixture.ctx.on('approval/request', () => {
      requestedApproval = true
      return Promise.resolve('allowed-once' as const)
    })

    await runParentTurn(fixture.parent)

    const results = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.isError).toBe(true)
    expect(results[0]?.data.error?.code).toBe('GIT_WORKTREE_DIRTY')
    expect(requestedApproval).toBe(false)
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('rejects a configured subagent provider without scoped in-process support before cloning', async () => {
    fixture = await setup({ providerName: 'missing' })
    answerRepositoryAuthorization(fixture.ctx, 'allowed-once')

    await runParentTurn(fixture.parent)

    const results = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.isError).toBe(true)
    expect(results[0]?.data.error?.code).toBe('SCOPED_PROVIDER_UNAVAILABLE')
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('requires fresh approval when a selected repository changes while the approval is pending', async () => {
    fixture = await setup()
    fixture.ctx.on('approval/request', async (request) => {
      if (request.toolName !== 'coordinate_repositories') return 'unavailable'
      await writeFile(join(fixture!.alpha.path, 'authorization-race.txt'), 'changed during approval\n')
      await gitAt(fixture!.alpha.path, 'add', '--', 'authorization-race.txt')
      await gitAt(
        fixture!.alpha.path,
        '-c', 'user.name=DSH fixture',
        '-c', 'user.email=dsh-fixture@example.invalid',
        'commit', '--no-gpg-sign', '-m', 'change during approval',
      )
      return 'allowed-once'
    })
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })

    await runParentTurn(fixture.parent)

    const results = fixture.parent.session.snapshotEvents().filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data.error?.code).toBe('APPROVED_REPOSITORY_CHANGED')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('cancels an unanswered authorization before creating clones or children', async () => {
    fixture = await setup()
    let requestArrived!: () => void
    const requestReceived = new Promise<void>((resolve) => { requestArrived = resolve })
    fixture.ctx.on('approval/request', (request) => {
      if (request.toolName === 'coordinate_repositories') requestArrived()
      return new Promise<ApprovalOutcome>(() => {})
    })
    const started: string[] = []
    fixture.ctx.on('subagent/start', ({ id }) => { started.push(String(id)) })

    const turn = runParentTurn(fixture.parent)
    await requestReceived
    fixture.parent.cancel({ kind: 'user' })
    await turn

    const events = fixture.parent.session.snapshotEvents()
    expect(events.find((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')?.data.outcome).toBe('cancelled')
    expect(started).toEqual([])
    expect(await readdir(fixture.dshHome)).toEqual([])
  }, 30_000)

  it('keeps an ordinary single-repository in-process subagent working', async () => {
    fixture = await setup()
    const activation = await fixture.ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'single repository task',
      name: 'single-repository-worker',
      parent: fixture.parent,
      prompt: [{ type: 'text', text: 'Return the single-repository result.' }],
      signal: new AbortController().signal,
      delivery: 'caller',
      agentOptions: { provider: 'single', model: 'single' },
    })
    const result = await activation.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'ordinary single-repository child completed' }])
    expect(activation.runId).toBeTruthy()
    await activation.dispose()
  }, 30_000)
})
