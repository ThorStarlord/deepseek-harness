import { execFile } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { createUserMessage, HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import Subagents from '@deepseek-ai/dsh-subagent'
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import * as ToolMultiRepository from '../src/index.ts'
import { assertReadOnlyGitCommand, gitNullDevice } from '../src/read-only-git-command.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const execFileAsync = promisify(execFile)
const contexts: Context[] = []
const roots: string[] = []
const REPO_READ_TOOLS = ['read_staged_file', 'repository_list_files', 'repository_read_file']

interface WorkflowOptions {
  readonly approval?: ApprovalOutcome
  readonly repositories?: readonly [string, string]
  readonly selectThird?: boolean
  readonly betaTitle?: string
  readonly failBeta?: boolean
  readonly attemptForbiddenTools?: boolean
  readonly changeAlphaDuringRead?: boolean
  readonly removeAlphaGitDuringRead?: boolean
  readonly noAlphaRootInstructions?: boolean
  readonly alphaRootMode?: 'ignored' | 'directory' | 'oversized' | 'outside-link' | 'claude'
  readonly malformedStagedIndex?: 'missing-separator' | 'missing-stage'
  readonly hangChildren?: boolean
}

interface Fixture {
  readonly ctx: Context
  readonly parent: Agent
  readonly parentId: SessionId
  readonly adapter: MockAdapter
  readonly alphaPath: string
  readonly betaPath: string
  readonly thirdPath: string
  readonly alphaHead: string
  readonly betaHead: string
  readonly childAgents: Map<string, Agent>
  readonly starts: Array<{ readonly id: string; readonly runId: string }>
  readonly ends: string[]
  readonly approvalRequests: Array<{ readonly toolName: string; readonly reason?: string }>
  readonly workspaces: Workspace[]
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
}, 30_000)

async function setup(options: WorkflowOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-multi-repository-read-'))
  roots.push(root)
  const parentCwd = join(root, 'parent')
  const workspacesPath = join(root, 'workspaces')
  const alphaPath = join(workspacesPath, 'alpha')
  const betaPath = join(workspacesPath, 'beta')
  const thirdPath = join(workspacesPath, 'unselected-third')
  await Promise.all([parentCwd, alphaPath, betaPath, thirdPath].map(path => mkdir(path, { recursive: true })))
  const alphaHead = await initializeRepository(alphaPath, 'analysis-alpha', 'ALPHA ROOT INSTRUCTIONS')
  const betaHead = await initializeRepository(betaPath, 'release-beta', 'BETA ROOT INSTRUCTIONS')
  await initializeRepository(thirdPath, 'main-third', 'THIRD REPOSITORY CONTENT')
  if (options.noAlphaRootInstructions === true) await rm(join(alphaPath, 'AGENTS.md'))
  if (options.alphaRootMode !== undefined) {
    const rootInstructions = join(alphaPath, 'AGENTS.md')
    if (options.alphaRootMode === 'ignored') {
      const ignored = await readFile(join(alphaPath, '.gitignore'), 'utf8')
      await writeFile(join(alphaPath, '.gitignore'), `${ignored}AGENTS.md\n`)
    } else if (options.alphaRootMode === 'directory') {
      await rm(rootInstructions)
      await mkdir(rootInstructions)
    } else if (options.alphaRootMode === 'oversized') {
      await writeFile(rootInstructions, Buffer.alloc(16 * 1024 + 1, 'x'))
    } else if (options.alphaRootMode === 'outside-link') {
      await rm(rootInstructions)
      await symlink(thirdPath, rootInstructions, 'junction')
    } else {
      await rm(rootInstructions)
      await writeFile(join(alphaPath, 'CLAUDE.md'), 'ALPHA CLAUDE INSTRUCTIONS\n')
    }
  }

  const alpha = workspaceRecord('workspace-alpha', 'Alpha repository', alphaPath)
  const beta = workspaceRecord('workspace-beta', options.betaTitle ?? 'Beta repository', betaPath)
  const third = workspaceRecord('workspace-third', 'Unselected third repository', thirdPath)
  const workspaces: Workspace[] = [alpha, beta, third]
  const parentId = SessionId(`multi-repository-parent-${randomUUID()}`)
  const childAgents = new Map<string, Agent>()
  const childRepositories = new Map<string, 'alpha' | 'beta'>()
  const starts: Array<{ readonly id: string; readonly runId: string }> = []
  const ends: string[] = []
  const approvalRequests: Array<{ readonly toolName: string; readonly reason?: string }> = []
  const childSteps = new Map<string, number>()
  const parentCalls = { value: 0 }
  const dispatch = (request: GenerateOptions): StreamChunk[] => {
    if (request.sessionId === parentId) {
      if (parentCalls.value++ === 0) {
        const repositories = options.repositories ?? [alphaPath, options.selectThird === true ? thirdPath : betaPath]
        return toolCallResponse('coordinate-repositories', 'coordinate_repositories', {
          repositories,
          task: 'Compare the repository instructions and the current implementation evidence.',
        })
      }
      const transcript = JSON.stringify(request.messages)
      return textResponse(transcript.includes('Alpha repository') && transcript.includes('Beta repository')
        ? 'Alpha repository: alpha-core.ts:1. Beta repository: beta-core.ts:1. Results are attributed to their own Sessions.'
        : 'The coordinated repository evidence was incomplete.')
    }

    const transcript = JSON.stringify(request.messages)
    if (transcript.includes('ORDINARY SINGLE-REPOSITORY TASK')) {
      return textResponse('ordinary single-repository child completed')
    }
    const repo = childRepositories.get(String(request.sessionId)) ?? (transcript.includes('ALPHA ROOT INSTRUCTIONS')
      || transcript.includes('ALPHA CLAUDE INSTRUCTIONS')
      || transcript.includes('No root AGENTS.md or CLAUDE.md instructions were found.') ? 'alpha' : 'beta')
    const repoPath = repo === 'alpha' ? alphaPath : betaPath
    const instruction = repo === 'alpha' ? 'ALPHA' : 'BETA'
    const otherInstruction = repo === 'alpha' ? 'BETA ROOT INSTRUCTIONS' : 'ALPHA ROOT INSTRUCTIONS'
    const key = String(request.sessionId)
    const step = childSteps.get(key) ?? 0
    childSteps.set(key, step + 1)
    const toolNames = request.tools?.map(tool => tool.name).sort() ?? []
    expect(toolNames).toEqual(REPO_READ_TOOLS)
    const alphaHasRootInstructions = options.noAlphaRootInstructions !== true
      && options.alphaRootMode !== 'ignored'
      && options.alphaRootMode !== 'directory'
      && options.alphaRootMode !== 'oversized'
      && options.alphaRootMode !== 'outside-link'
    if (repo !== 'alpha' || alphaHasRootInstructions) {
      expect(transcript).toContain(`${instruction} ROOT INSTRUCTIONS`)
    }
    if (repo === 'alpha' && options.alphaRootMode === 'claude') expect(transcript).toContain('ALPHA CLAUDE INSTRUCTIONS')
    if (repo === 'alpha' && !alphaHasRootInstructions && options.alphaRootMode !== 'claude') {
      expect(transcript).toContain('No root AGENTS.md or CLAUDE.md instructions were found.')
    }
    expect(transcript).not.toContain(otherInstruction)

    if (options.failBeta === true && repo === 'beta' && step === 0) throw new Error('fixture model failure')
    if (options.changeAlphaDuringRead === true && repo === 'alpha' && step === 0) {
      writeFileSync(join(alphaPath, 'src', 'core.ts'), 'export const value = "changed during analysis"\n')
    }
    if (options.removeAlphaGitDuringRead === true && repo === 'alpha' && step === 0) {
      renameSync(join(alphaPath, '.git'), join(alphaPath, '.git-temporarily-unavailable'))
      return textResponse('Alpha could not verify repository state during this observation.')
    }

    if (step === 0) {
      return toolCallsResponse([
        { id: 'list-files', name: 'repository_list_files', args: {} },
        { id: 'read-nested-instructions', name: 'repository_read_file', args: { path: 'src/AGENTS.md' } },
        { id: 'read-live-tree', name: 'repository_read_file', args: { path: 'src/core.ts', offset: 1, limit: 10 } },
        { id: 'read-staged-index', name: 'read_staged_file', args: { path: 'src/core.ts' } },
        { id: 'read-untracked', name: 'repository_read_file', args: { path: 'src/draft.ts' } },
      ])
    }
    if (step === 1) {
      if (options.malformedStagedIndex !== undefined && repo === 'alpha') {
        return textResponse('The staged index entry was malformed and could not be inspected.')
      }
      expect(transcript).toContain(options.changeAlphaDuringRead === true && repo === 'alpha'
        ? 'changed during analysis' : `working-${repo}`)
      expect(transcript).toContain(`staged-${repo}`)
      expect(transcript).toContain(`draft-${repo}`)
      expect(transcript).toContain(`${instruction} ROOT INSTRUCTIONS NESTED`)
      expect(transcript).toContain('src/draft.ts')
      expect(transcript).not.toContain('cache.ignored')
      expect(transcript).not.toContain('.env')
      return toolCallsResponse([
        { id: 'read-ignored', name: 'repository_read_file', args: { path: 'cache.ignored' } },
        { id: 'read-secret', name: 'repository_read_file', args: { path: '.env' } },
        { id: 'read-outside', name: 'repository_read_file', args: { path: join(thirdPath, 'sentinel.txt') } },
        { id: 'read-traversal', name: 'repository_read_file', args: { path: '../unselected-third/sentinel.txt' } },
        ...options.attemptForbiddenTools === true ? [
          { id: 'read-empty', name: 'repository_read_file', args: { path: '' } },
          { id: 'read-directory', name: 'repository_read_file', args: { path: 'src' } },
          { id: 'read-missing', name: 'repository_read_file', args: { path: 'src/missing.ts' } },
          { id: 'read-large', name: 'repository_read_file', args: { path: 'large.bin' } },
          { id: 'read-offset', name: 'repository_read_file', args: { path: 'src/core.ts', offset: 0 } },
          { id: 'read-limit', name: 'repository_read_file', args: { path: 'src/core.ts', limit: 401 } },
          { id: 'read-git-alias', name: 'repository_read_file', args: { path: 'git-link/config' } },
          { id: 'read-outside-alias', name: 'repository_read_file', args: { path: 'outside-link/AGENTS.md' } },
        ] : [],
      ])
    }
    if (step === 2) {
      expect(transcript).not.toContain('fixture-private-secret')
      expect(transcript).not.toContain('THIRD REPOSITORY CONTENT')
      if (options.attemptForbiddenTools === true) {
        expect(transcript).toContain('git-link/config')
        expect(transcript).toContain('outside-link/AGENTS.md')
        return toolCallsResponse([
          { id: 'staged-ignored', name: 'read_staged_file', args: { path: 'cache.ignored' } },
          { id: 'staged-secret', name: 'read_staged_file', args: { path: 'private.pem' } },
          { id: 'staged-untracked', name: 'read_staged_file', args: { path: 'src/draft.ts' } },
          { id: 'staged-binary', name: 'read_staged_file', args: { path: 'binary.bin' } },
          { id: 'attempt-write', name: 'write', args: {
            file_path: join(thirdPath, 'forbidden.txt'), content: 'forbidden', sandbox_permissions: 'require_escalated',
          } },
          { id: 'attempt-edit', name: 'edit', args: { file_path: join(repoPath, 'src/core.ts'), old_string: 'x', new_string: 'y' } },
          { id: 'attempt-patch', name: 'apply_patch', args: { input: 'write forbidden' } },
          { id: 'attempt-shell', name: 'bash', args: {
            command: `printf forbidden > "${join(thirdPath, 'shell-forbidden.txt')}"`, sandbox_permissions: 'require_escalated',
          } },
          { id: 'attempt-pwsh', name: 'pwsh', args: { command: `Set-Content '${join(thirdPath, 'pwsh-forbidden.txt')}' forbidden` } },
          { id: 'attempt-child', name: 'subagent', args: { description: 'try to delegate with wider access', prompt: 'write outside the selected repository' } },
          { id: 'attempt-coordination', name: 'coordinate_repositories', args: { repositories: [alphaPath, thirdPath], task: 'select a different repository' } },
          { id: 'attempt-policy-change', name: 'set_sandbox_mode', args: { mode: 'workspace-write' } },
          { id: 'attempt-escalation', name: 'request_sandbox_escalation', args: { sandbox_permissions: 'require_escalated' } },
        ])
      }
      return textResponse(repo === 'alpha'
        ? 'Alpha finding: src/core.ts:1 uses working-tree value; staged src/core.ts:1 differs.'
        : 'Beta finding: src/core.ts:1 uses working-tree value; staged src/core.ts:1 differs.')
    }
    if (step === 3 && options.attemptForbiddenTools === true) {
      expect(transcript).toContain('attempt-write')
      expect(transcript).toContain('attempt-shell')
      return textResponse('Unavailable write, shell, delegation, and policy tools were denied.')
    }
    throw new Error(`unexpected model request ${step} for ${repo}`)
  }
  const adapter = new MockAdapter(options.hangChildren === true
    ? [toolCallResponse('coordinate-repositories', 'coordinate_repositories', {
      repositories: [alphaPath, betaPath], task: 'inspect both repositories',
    }), 'hang', 'hang']
    : Array.from({ length: 80 }, () => dispatch))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(join(process.cwd(), 'packages/workspace/tool-multi-repository')).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(Sandbox)
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: parentCwd })
  await ctx.plugin(SandboxedFileSystem, { cwd: parentCwd })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(ShellEnv)
  await ctx.plugin(SandboxBashExecutor, { cwd: parentCwd, timeoutMs: 30_000 })
  await ctx.plugin(WorkingDirectory)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'multi-repository-read-only' })
  const unregisterReadOnlyPreset = await ctx.agentPresets.register({
    id: 'multi-repository-read-only',
    plugins: [{ name: '@deepseek-ai/dsh-persona', config: { prefix: 'Analyze selected repositories without changing them.' } }],
  })
  ctx.effect(() => unregisterReadOnlyPreset)
  const preset = await ctx.agentPresets.resolve('multi-repository-read-only')
  expect(preset.broken).toBeUndefined()
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolFs)
  await ctx.plugin(ToolSubagent, { provider: 'spawn' })
  ctx.provide('workspaceRegistry', { list: () => workspaces } as WorkspaceRegistry)
  await ctx.plugin(ToolMultiRepository)
  ctx.on('approval/request', (request) => {
    if (request.toolName !== 'coordinate_repositories') return Promise.resolve('rejected')
    approvalRequests.push({
      toolName: request.toolName,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    })
    return Promise.resolve(options.approval ?? 'allowed-once')
  })
  ctx.on('subagent/start', (info) => {
    starts.push({ id: String(info.id), runId: String(info.runId) })
    const child = ctx.agents.get(info.id)
    if (child !== undefined) {
      childAgents.set(String(info.id), child)
      childRepositories.set(String(info.id), ctx.workingDirectory.get(child.session) === alphaPath ? 'alpha' : 'beta')
    }
  })
  ctx.on('subagent/end', (info) => { ends.push(String(info.id)) })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(parentId, { provider: 'mock', model: 'mock' }, { cwd: parentCwd })
  return {
    ctx, parent, parentId, adapter, alphaPath, betaPath, thirdPath, alphaHead, betaHead,
    childAgents, starts, ends, approvalRequests, workspaces,
  }
}

describe('read-only multi-repository coordination', () => {
  it('allows only fixed read-only Git builtins and uses each platform null device', () => {
    for (const verb of ['rev-parse', 'branch', 'diff', 'ls-files', 'cat-file', 'check-ignore']) {
      expect(() => { assertReadOnlyGitCommand(['--literal-pathspecs', verb, '--', 'repository path']) }).not.toThrow()
    }
    for (const args of [[], ['--'], ['commit', '-m', 'must be refused']]) {
      let error: unknown
      try { assertReadOnlyGitCommand(args) } catch (caught: unknown) { error = caught }
      expect(error).toMatchObject({ code: 'GIT_COMMAND_DENIED' })
    }
    expect(gitNullDevice('win32')).toBe('NUL')
    expect(gitNullDevice('linux')).toBe('/dev/null')
  })

  it('rejects coordinator calls without parent authority and keeps repository readers worker-only', async () => {
    const f = await setup()
    const coordinate = f.ctx.tools.get('coordinate_repositories')
    expect(coordinate).toBeDefined()
    await expect(coordinate?.execute(
      { repositories: [f.alphaPath, f.betaPath], task: 'inspect both repositories' },
      directToolContext('coordinate_repositories', {}, undefined),
    )).rejects.toMatchObject({ code: 'PARENT_UNAVAILABLE' })
    await expect(coordinate?.execute(
      { repositories: [f.alphaPath, f.betaPath], task: 'inspect both repositories' },
      directToolContext('coordinate_repositories', {}, f.parent),
    )).rejects.toMatchObject({ code: 'READ_AUTHORIZATION_REQUIRED' })

    for (const name of REPO_READ_TOOLS) {
      const reader = f.ctx.tools.get(name)
      expect(reader).toBeDefined()
      await expect(reader?.execute({}, directToolContext(name, {}, undefined)))
        .rejects.toMatchObject({ code: 'REPOSITORY_WORKER_REQUIRED' })
      await expect(reader?.execute({}, directToolContext(name, {}, f.parent)))
        .rejects.toMatchObject({ code: 'REPOSITORY_WORKER_REQUIRED' })
    }
    expect(await f.parent.ctx.waterfall(
      'tools/pre-execute',
      directToolContext('write', {}, undefined),
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).toEqual({ kind: 'allow' })
  }, 30_000)

  it('renders safe fallbacks for malformed tool output values', async () => {
    const f = await setup()
    const render = (name: string, value: JsonValue) => f.ctx.tools.get(name)?.output?.render?.({}, value)
    expect(render('read_staged_file', null)).toEqual([{ type: 'text', text: 'Staged index content is unavailable.' }])
    expect(render('repository_list_files', null)).toEqual([{ type: 'text', text: 'Repository file list is unavailable.' }])
    expect(render('repository_list_files', { paths: ['src/core.ts', 42], totalFiles: 2 }))
      .toEqual([{ type: 'text', text: 'Repository files (2; 0 secret-like or Git metadata paths omitted):\nsrc/core.ts' }])
    expect(render('repository_read_file', null)).toEqual([{ type: 'text', text: 'Working-tree file content is unavailable.' }])
    expect(render('repository_read_file', {
      path: 'src/core.ts', offset: 1, totalLines: 2, lines: [{ number: 1, text: 'ok' }, { number: '2', text: 42 }],
    })).toEqual([{ type: 'text', text: 'src/core.ts (working tree; lines 1–1 of 2):\n1: ok' }])
    expect(render('coordinate_repositories', null)).toEqual([{ type: 'text', text: '' }])
    expect(render('coordinate_repositories', { repositories: 'invalid' })).toEqual([{ type: 'text', text: '' }])

    const renderedText = (name: string, value: JsonValue): string => {
      const block = render(name, value)?.[0]
      return block?.type === 'text' ? block.text : ''
    }
    const resultText = (row: JsonValue): string => renderedText('coordinate_repositories', { repositories: [row] })
    const validRow: { [key: string]: JsonValue } = {
      execution: 'result', gitCommandEnforcement: 'partial', workspaceId: 'workspace-alpha',
      workspaceTitle: 'Alpha repository', root: 'C:/work/alpha', gitIdentity: 'C:/work/alpha/.git',
      head: 'abc123', branch: null, stagedPaths: [], unstagedPaths: [], untrackedPaths: [],
      stagedCount: 0, unstagedCount: 0, untrackedCount: 0, ignoredPathCount: 0,
      childSessionId: null, runId: null, stopReason: 'not-started', assistantOutput: '',
      sourceChanged: null, observedAtStart: 'start', observedAtEnd: null, observationError: 'Git unavailable',
    }
    const fallback = resultText(validRow)
    expect(fallback).toContain('branch (detached)')
    expect(fallback).toContain('Child Session not started; run not started')
    expect(fallback).toContain('Source changed during analysis: unknown')
    expect(fallback).toContain('observation start to unfinished')
    expect(fallback).toContain('could not be rechecked')
    expect(fallback).toContain('Final source observation error: Git unavailable')
    expect(fallback).toContain('(no child text output)')

    const completeRow = {
      ...validRow, branch: 'analysis-alpha', childSessionId: 'child-alpha', runId: 'run-alpha',
      sourceChanged: true, observedAtEnd: 'end', observationError: null, assistantOutput: 'Alpha finding',
    }
    expect(resultText(completeRow)).toContain('Alpha finding')
    expect(resultText(completeRow)).toContain('findings as potentially stale')
    expect(resultText({ ...completeRow, sourceChanged: false })).not.toContain('findings as potentially stale')
    const invalidRows: JsonValue[] = [
      null,
      { ...validRow, execution: 1 },
      { ...validRow, gitCommandEnforcement: 'none' },
      { ...validRow, workspaceId: 1 },
      { ...validRow, workspaceTitle: 1 },
      { ...validRow, root: 1 },
      { ...validRow, gitIdentity: 1 },
      { ...validRow, head: 1 },
      { ...validRow, stagedPaths: null },
      { ...validRow, unstagedPaths: null },
      { ...validRow, untrackedPaths: null },
      { ...validRow, stagedCount: '0' },
      { ...validRow, unstagedCount: '0' },
      { ...validRow, untrackedCount: '0' },
      { ...validRow, assistantOutput: 1 },
    ]
    for (const invalidRow of invalidRows) expect(resultText(invalidRow)).toBe('')
  }, 30_000)

  it('denies malformed and duplicate selections before asking for repository approval', async () => {
    const f = await setup()
    const inputCases: unknown[] = [
      null,
      { repositories: 'not-an-array', task: 'inspect' },
      { repositories: [f.alphaPath], task: 'inspect' },
      { repositories: [f.alphaPath, f.betaPath], task: '' },
      { repositories: [1, f.betaPath], task: 'inspect' },
      { repositories: [f.alphaPath, 1], task: 'inspect' },
      { repositories: [f.alphaPath, f.alphaPath], task: 'inspect' },
    ]
    const decisions: PreToolDecision[] = []
    for (const argumentsValue of inputCases) {
      decisions.push(await f.parent.ctx.waterfall(
        'tools/pre-execute',
        directToolContext('coordinate_repositories', argumentsValue, f.parent),
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      ))
    }
    expect(decisions.slice(0, 6).every(decision => decision.kind === 'deny')).toBe(true)
    expect(decisions[6]).toMatchObject({ kind: 'deny', reason: 'select two distinct registered Workspace roots' })
    await expect(f.parent.ctx.waterfall(
      'tools/pre-execute',
      directToolContext('coordinate_repositories', { repositories: ['relative', f.betaPath], task: 'inspect' }, f.parent),
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).rejects.toMatchObject({ code: 'WORKSPACE_NOT_SELECTED' })
    await expect(f.parent.ctx.waterfall(
      'tools/pre-execute',
      directToolContext('coordinate_repositories', { repositories: [join(f.alphaPath, 'src'), f.betaPath], task: 'inspect' }, f.parent),
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).rejects.toMatchObject({ code: 'WORKSPACE_NOT_SELECTED' })
    const hostPath = vi.spyOn(f.ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)
    await expect(f.parent.ctx.waterfall(
      'tools/pre-execute',
      directToolContext('coordinate_repositories', { repositories: [f.alphaPath, f.betaPath], task: 'inspect' }, f.parent),
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).rejects.toMatchObject({ code: 'LOCAL_FILESYSTEM_REQUIRED' })
    hostPath.mockRestore()
    expect(f.approvalRequests).toEqual([])
    expect(f.starts).toEqual([])
  }, 30_000)

  it('rejects approval reuse after the task or registered Workspace identity changes', async () => {
    const f = await setup()
    const tool = f.ctx.tools.get('coordinate_repositories')
    expect(tool).toBeDefined()
    const taskCall = directToolContext('coordinate_repositories', {
      repositories: [f.alphaPath, f.betaPath], task: 'approved task',
    }, f.parent)
    const taskApproval = await f.parent.ctx.waterfall(
      'tools/pre-execute',
      taskCall,
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )
    expect(taskApproval).toMatchObject({ kind: 'ask' })
    await expect(tool?.execute(
      { repositories: [f.alphaPath, f.betaPath], task: 'different task' }, taskCall,
    )).rejects.toMatchObject({ code: 'READ_AUTHORIZATION_REQUIRED' })

    for (const index of [0, 1]) {
      const original = f.workspaces[index]
      expect(original).toBeDefined()
      const args = { repositories: [f.alphaPath, f.betaPath], task: 'approved task' }
      const call = directToolContext('coordinate_repositories', args, f.parent)
      const decision = await f.parent.ctx.waterfall(
        'tools/pre-execute',
        call,
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      )
      expect(decision).toMatchObject({ kind: 'ask' })
      f.workspaces[index] = workspaceRecord(`${original?.id}-changed`, original?.title ?? '', original?.path ?? '')
      await expect(tool?.execute(args, call)).rejects.toMatchObject({ code: 'APPROVED_REPOSITORY_CHANGED' })
      if (original !== undefined) f.workspaces[index] = original
    }
    expect(f.starts).toEqual([])
  }, 30_000)

  it('requires each registered Workspace to be a directory at the Git repository root', async () => {
    const f = await setup()
    const tool = f.ctx.tools.get('coordinate_repositories')
    expect(tool).toBeDefined()
    const fileRoot = join(f.alphaPath, 'not-a-workspace-directory')
    await writeFile(fileRoot, 'file')
    f.workspaces.push(workspaceRecord('workspace-file', 'File Workspace', fileRoot))
    await expect(f.parent.ctx.waterfall(
      'tools/pre-execute',
      directToolContext('coordinate_repositories', {
        repositories: [fileRoot, f.betaPath], task: 'inspect file root',
      }, f.parent),
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).rejects.toMatchObject({ code: 'WORKSPACE_NOT_SELECTED' })

    const nestedRoot = join(f.alphaPath, 'nested-workspace')
    await mkdir(nestedRoot)
    f.workspaces.push(workspaceRecord('workspace-nested', 'Nested Workspace', nestedRoot))
    const args = { repositories: [nestedRoot, f.betaPath], task: 'inspect nested root' }
    const call = directToolContext('coordinate_repositories', args, f.parent)
    expect(await f.parent.ctx.waterfall(
      'tools/pre-execute', call, () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).toMatchObject({ kind: 'ask' })
    await expect(tool?.execute(args, call)).rejects.toMatchObject({ code: 'GIT_ROOT_REQUIRED' })
    expect(f.starts).toEqual([])
  }, 30_000)

  it('rejects two Git worktrees that share one repository identity', async () => {
    const f = await setup()
    const linkedRoot = join(f.alphaPath, '..', 'alpha-linked-worktree')
    await git(f.alphaPath, ['worktree', 'add', '--detach', linkedRoot, 'HEAD'])
    f.workspaces.push(workspaceRecord('workspace-alpha-linked', 'Alpha linked worktree', linkedRoot))
    const tool = f.ctx.tools.get('coordinate_repositories')
    expect(tool).toBeDefined()
    const args = { repositories: [f.alphaPath, linkedRoot], task: 'inspect both worktrees' }
    const call = directToolContext('coordinate_repositories', args, f.parent)
    expect(await f.parent.ctx.waterfall(
      'tools/pre-execute', call, () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )).toMatchObject({ kind: 'ask' })
    await expect(tool?.execute(args, call)).rejects.toMatchObject({ code: 'DUPLICATE_REPOSITORY' })
    expect(f.starts).toEqual([])
  }, 30_000)

  it('coordinates two dirty repositories in one parent Session without exposing write tools', async () => {
    const f = await setup()
    const before = await Promise.all([f.alphaPath, f.betaPath, f.thirdPath].map(snapshotRepository))
    f.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Compare the current source and instructions in Alpha and Beta.' }],
      source: { kind: 'user' },
    }))
    await f.parent.whenIdle()

    expect(f.parent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    const parentMessages = f.adapter.requests.filter(request => request.sessionId === f.parentId)
    expect(parentMessages).toHaveLength(2)
    expect(JSON.stringify(parentMessages[1]?.messages)).toContain('Alpha repository')
    expect(JSON.stringify(parentMessages[1]?.messages)).toContain('Beta repository')
    expect(f.parent.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1))
      .toMatchObject({ type: 'assistant/message' })
    const parentReply = f.parent.session.snapshotEvents().filter(event => event.type === 'assistant/message').at(-1)
    expect(JSON.stringify(parentReply)).toContain('Alpha repository:')
    expect(JSON.stringify(parentReply)).toContain('Beta repository:')
    expect(f.approvalRequests).toHaveLength(1)
    expect(f.approvalRequests[0]?.reason).toContain(f.alphaPath.replaceAll('\\', '\\\\'))
    expect(f.approvalRequests[0]?.reason).toContain(f.betaPath.replaceAll('\\', '\\\\'))
    expect(f.starts).toHaveLength(2)
    expect(f.ends).toHaveLength(2)
    expect(new Set(f.starts.map(start => start.id)).size).toBe(2)
    expect(new Set(f.starts.map(start => start.runId)).size).toBe(2)
    const childRequests = f.adapter.requests.filter(request => request.sessionId !== f.parentId)
    expect(childRequests).toHaveLength(6)
    for (const request of childRequests) expect(request.tools?.map(tool => tool.name).sort()).toEqual(REPO_READ_TOOLS)

    const children = [...f.childAgents.values()]
    expect(children).toHaveLength(2)
    const childRoots = children.map(child => f.ctx.workingDirectory.get(child.session)).sort()
    expect(childRoots).toEqual([f.alphaPath, f.betaPath].sort())
    for (const child of children) {
      expect(child.session.header.parentSession).toBe(f.parentId)
      expect(child.session.snapshotEvents()).toContainEqual(expect.objectContaining({
        type: 'working-directory/change', data: { cwd: f.ctx.workingDirectory.get(child.session) },
      }))
      expect(child.session.snapshotEvents()).toContainEqual(expect.objectContaining({
        type: 'sandbox/mode', data: { mode: 'read-only', source: 'delegation' },
      }))
      const childResults = child.session.snapshotEvents().filter(event => event.type === 'tool/result')
      expect(childResults).toHaveLength(9)
      const readErrors = childResults.flatMap(event => event.type === 'tool/result' && event.data.error !== undefined
        ? [event.data.error.code] : [])
      expect(readErrors).toContain('IGNORED_PATH_DENIED')
      expect(readErrors).toContain('PROTECTED_PATH_DENIED')
      expect(readErrors).toContain('OUTSIDE_REPOSITORY')
    }

    const parentToolResult = f.parent.session.snapshotEvents().find(event => event.type === 'tool/result')
    expect(parentToolResult?.type === 'tool/result' ? JSON.stringify(parentToolResult.data) : '').toContain('src/core.ts:1')
    expect(parentToolResult?.type === 'tool/result' ? JSON.stringify(parentToolResult.data) : '').toContain(f.alphaHead)
    expect(parentToolResult?.type === 'tool/result' ? JSON.stringify(parentToolResult.data) : '').toContain(f.betaHead)
    expect(parentToolResult?.type === 'tool/result' ? JSON.stringify(parentToolResult.data) : '')
      .toContain('ignored untracked files excluded: 2')
    expect(parentToolResult?.type === 'tool/result' ? JSON.stringify(parentToolResult.data) : '')
      .toContain('Git command enforcement: partial')

    const after = await Promise.all([f.alphaPath, f.betaPath, f.thirdPath].map(snapshotRepository))
    expect(after).toEqual(before)
    expect(JSON.stringify(parentToolResult?.type === 'tool/result' ? parentToolResult.data : {}))
      .not.toContain('fixture-private-secret')
    expect(JSON.stringify(parentToolResult?.type === 'tool/result' ? parentToolResult.data : {}))
      .not.toContain('THIRD REPOSITORY CONTENT')
  }, 30_000)

  it('does not treat registration as read authorization for the current repository selection', async () => {
    const rejected = await setup({ approval: 'rejected', selectThird: true })
    const before = await snapshotRepository(rejected.thirdPath)
    rejected.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Read Alpha and the registered third repository.' }],
      source: { kind: 'user' },
    }))
    await rejected.parent.whenIdle()
    expect(rejected.approvalRequests).toHaveLength(1)
    expect(rejected.approvalRequests[0]?.reason).toContain(rejected.thirdPath.replaceAll('\\', '\\\\'))
    expect(rejected.starts).toEqual([])
    expect(await snapshotRepository(rejected.thirdPath)).toEqual(before)
  }, 30_000)

  it('rejects write, shell, child, and policy attempts from read-only workers', async () => {
    const f = await setup({ attemptForbiddenTools: true })
    for (const repo of [f.alphaPath, f.betaPath]) {
      await writeFile(join(repo, 'private.pem'), 'fixture-private-key')
      await writeFile(join(repo, 'binary.bin'), Buffer.from([0, 255, 1]))
      await writeFile(join(repo, 'large.bin'), Buffer.alloc(1024 * 1024 + 1, 1))
      await git(repo, ['add', '--', 'private.pem', 'binary.bin'])
      await symlink(f.thirdPath, join(repo, 'outside-link'), 'junction')
      await symlink(join(repo, '.git'), join(repo, 'git-link'), 'junction')
    }
    const signal = new AbortController().signal
    const largeTarget = await f.ctx.fs.resolve(join(f.alphaPath, 'large.bin'), { signal })
    expect(await f.ctx.fs.stat(largeTarget, signal)).toMatchObject({ type: 'file', size: 1024 * 1024 + 1 })
    const before = await Promise.all([f.alphaPath, f.betaPath, f.thirdPath].map(snapshotRepository))
    f.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Analyze Alpha and Beta and try the available file, shell, and delegation operations.' }],
      source: { kind: 'user' },
    }))
    await f.parent.whenIdle()
    const childRequests = f.adapter.requests.filter(request => request.sessionId !== f.parentId)
    expect(childRequests).toHaveLength(8)
    for (const request of childRequests) expect(request.tools?.map(tool => tool.name).sort()).toEqual(REPO_READ_TOOLS)
    for (const child of f.childAgents.values()) {
      const results = child.session.snapshotEvents().filter(event => event.type === 'tool/result')
      expect(results).toHaveLength(30)
      const errorCodes = results.flatMap(event => event.type === 'tool/result' && event.data.error !== undefined
        ? [event.data.error.code] : [])
      const largeReadResult = results.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'read-large')
      expect(largeReadResult).toMatchObject({ data: { error: { code: 'FILE_TOO_LARGE' } } })
      expect(errorCodes).toContain('INVALID_PATH')
      expect(errorCodes).toContain('FILE_NOT_FOUND')
      expect(errorCodes).toContain('FILE_TOO_LARGE')
      expect(errorCodes).toContain('INVALID_READ_LIMIT')
      expect(errorCodes).toContain('OUTSIDE_REPOSITORY')
      expect(errorCodes).toContain('PROTECTED_PATH_DENIED')
      expect(errorCodes).toContain('IGNORED_PATH_DENIED')
      expect(errorCodes).toContain('SECRET_PATH_DENIED')
      expect(errorCodes).toContain('STAGED_ENTRY_UNAVAILABLE')
      expect(errorCodes).toContain('STAGED_CONTENT_BINARY')
      const attemptedCallIds = [
        'attempt-write', 'attempt-edit', 'attempt-patch', 'attempt-shell', 'attempt-pwsh',
        'attempt-child', 'attempt-coordination', 'attempt-policy-change', 'attempt-escalation',
      ]
      const blockedResults = results.filter(event => event.type === 'tool/result'
        && attemptedCallIds.includes(String(event.data.message.toolCallId)))
      expect(blockedResults).toHaveLength(attemptedCallIds.length)
      expect(blockedResults.every(event => event.type === 'tool/result' && event.data.message.isError)).toBe(true)
      expect(blockedResults.some(event => event.type === 'tool/result' && event.data.error?.code === 'UNKNOWN_TOOL')).toBe(true)
    }
    expect(await Promise.all([f.alphaPath, f.betaPath, f.thirdPath].map(snapshotRepository))).toEqual(before)
  }, 30_000)

  it('returns an independent repository error without attributing it to the successful worker', async () => {
    const f = await setup({ failBeta: true })
    f.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Compare Alpha and Beta.' }], source: { kind: 'user' },
    }))
    await f.parent.whenIdle()
    expect(f.starts).toHaveLength(2)
    expect(f.ends).toHaveLength(2)
    const result = f.parent.session.snapshotEvents().find(event => event.type === 'tool/result')
    const content = result?.type === 'tool/result' ? JSON.stringify(result.data) : ''
    expect(content).toContain('Alpha repository')
    expect(content).toContain('Beta repository')
    expect(content).toContain('result-error')
    expect(content).toContain('Alpha finding:')
    expect(content).toContain('Beta repository')
    expect(content).toContain('stop error')
    expect(content.indexOf('Alpha repository')).toBeLessThan(content.indexOf('Alpha finding:'))
    expect(content.indexOf('Alpha finding:')).toBeLessThan(content.indexOf('Beta repository'))
    expect(content.indexOf('result-error')).toBeGreaterThan(content.indexOf('Beta repository'))
    expect(f.childAgents.size).toBe(2)
  }, 30_000)

  it('marks a live source change during analysis so the parent can qualify its findings', async () => {
    const f = await setup({ changeAlphaDuringRead: true })
    f.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Compare Alpha and Beta.' }], source: { kind: 'user' },
    }))
    await f.parent.whenIdle()
    const result = f.parent.session.snapshotEvents().find(event => event.type === 'tool/result')
    const content = result?.type === 'tool/result' ? JSON.stringify(result.data) : ''
    expect(content).toContain('"sourceChanged":true')
    expect(content).toContain('"sourceChanged":false')
    expect(content).toContain('findings as potentially stale')
    expect(await readFile(join(f.alphaPath, 'src', 'core.ts'), 'utf8')).toContain('changed during analysis')
  }, 30_000)

  it('reports when the repository state cannot be rechecked after analysis', async () => {
    const f = await setup({ removeAlphaGitDuringRead: true, noAlphaRootInstructions: true })
    f.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Compare Alpha and Beta.' }], source: { kind: 'user' },
    }))
    await f.parent.whenIdle()
    const result = f.parent.session.snapshotEvents().find(event => event.type === 'tool/result')
    const content = result?.type === 'tool/result' ? JSON.stringify(result.data) : ''
    expect(content).toContain('"sourceChanged":null')
    expect(content).toContain('could not be rechecked')
    expect(content).toContain('Final source observation error:')
  }, 30_000)

  it('refuses repositories with an unbounded untracked-file state before starting workers', async () => {
    const f = await setup()
    await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(
      join(f.alphaPath, `untracked-${index}.txt`),
      `${index}\n`,
    )))
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect bounded repository state'))
      .rejects.toMatchObject({ code: 'GIT_STATE_TOO_LARGE' })
    expect(f.starts).toEqual([])
  }, 30_000)

  it('requires the configured child preset to contain only the analysis persona', async () => {
    const f = await setup()
    const composition = f.ctx.agentPresets.inspectCompositions().find(row => row.id === 'multi-repository-read-only')
    expect(composition).toBeDefined()
    if (composition === undefined) throw new Error('read-only analysis preset is not mounted')
    const persona = composition.modules.find(module => module.moduleName === '@deepseek-ai/dsh-persona')
    expect(persona).toBeDefined()
    if (persona === undefined) throw new Error('read-only analysis preset is missing its persona')
    const inspect = vi.spyOn(f.ctx.agentPresets, 'inspectCompositions')
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{
        ...composition,
        modules: [persona, { ...persona, moduleName: '@deepseek-ai/dsh-tool-fs' }],
      }])
      .mockReturnValueOnce([{ ...composition, modules: [] }])
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'missing preset'))
      .rejects.toMatchObject({ code: 'READ_ONLY_PRESET_UNAVAILABLE' })
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'unsafe preset'))
      .rejects.toMatchObject({ code: 'UNSAFE_READ_ONLY_PRESET' })
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'preset without persona'))
      .rejects.toMatchObject({ code: 'UNSAFE_READ_ONLY_PRESET' })
    expect(inspect).toHaveBeenCalledTimes(3)
    expect(f.starts).toEqual([])
  }, 30_000)

  it('uses the confined argv when the sandbox reports full process enforcement', async () => {
    const f = await setup()
    vi.spyOn(f.ctx.sandbox, 'confine').mockImplementation(async argv => ({
      argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [],
    }))
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect under full confinement')
    expect((result as { repositories: readonly Record<string, unknown>[] }).repositories)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ workspaceId: 'workspace-alpha', gitCommandEnforcement: 'full' }),
        expect.objectContaining({ workspaceId: 'workspace-beta', gitCommandEnforcement: 'full' }),
      ]))
  }, 30_000)

  it('keeps a live read when metadata cannot report an untracked version or file size', async () => {
    const f = await setup()
    const originalLstat = f.ctx.fs.lstat.bind(f.ctx.fs)
    vi.spyOn(f.ctx.fs, 'lstat').mockImplementation(async (path, options, signal) => {
      if (path === 'src/draft.ts' && options?.cwd === f.alphaPath) return undefined
      return originalLstat(path, options, signal)
    })
    const originalStat = f.ctx.fs.stat.bind(f.ctx.fs)
    vi.spyOn(f.ctx.fs, 'stat').mockImplementation(async (target, signal) => {
      const info = await originalStat(target, signal)
      if (f.ctx.fs.processPath(target) === join(f.alphaPath, 'src', 'core.ts') && info !== undefined) {
        return { version: info.version, type: info.type }
      }
      return info
    })
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'read despite incomplete metadata')
    const rows = (result as { repositories: readonly Record<string, unknown>[] }).repositories
    expect(rows[0]).toMatchObject({ sourceChanged: false, workspaceId: 'workspace-alpha' })
    expect(f.adapter.requests.some(request => JSON.stringify(request.messages).includes('draft-alpha'))).toBe(true)
  }, 30_000)

  it('handles accepted read-only Git exit codes when collected output is absent', async () => {
    const f = await setup()
    const originalSpawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess)
    vi.spyOn(f.ctx.subprocess, 'spawn').mockImplementation(spec => spec.argv.includes('check-ignore')
      ? completedHandle({ exitCode: 1 })
      : originalSpawn(spec))
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect with empty Git output')
    expect((result as { repositories: readonly Record<string, unknown>[] }).repositories).toHaveLength(2)
  }, 30_000)

  it.each([
    { label: 'truncated stdout', handle: completedHandle({ exitCode: 0, stdout: { text: '', lossy: true } }), code: 'GIT_OUTPUT_TRUNCATED' },
    { label: 'truncated stderr', handle: completedHandle({ exitCode: 0, stderr: { text: '', lossy: true } }), code: 'GIT_OUTPUT_TRUNCATED' },
    { label: 'failed command diagnostics', handle: completedHandle({
      exitCode: 1, stderr: { text: 'fatal: fixture failure', lossy: false },
    }), code: 'GIT_COMMAND_FAILED' },
    { label: 'signaled command without diagnostics', handle: completedHandle({ exitCode: null, signal: 'SIGTERM' }), code: 'GIT_COMMAND_FAILED' },
    { label: 'unknown process termination', handle: completedHandle({ exitCode: null, signal: null }), code: 'GIT_COMMAND_FAILED' },
  ])('reports $label from the fixed Git reader', async ({ handle, code }) => {
    const f = await setup()
    const originalSpawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess)
    vi.spyOn(f.ctx.subprocess, 'spawn').mockImplementation(spec => spec.argv.includes('--show-toplevel')
      ? handle
      : originalSpawn(spec))
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], `exercise ${code}`))
      .rejects.toMatchObject({ code })
    expect(f.starts).toEqual([])
  }, 30_000)

  it.each([
    { label: 'missing index separator', mode: 'missing-separator' as const, stdout: 'not-an-index-record\0' },
    { label: 'missing index stage', mode: 'missing-stage' as const, stdout: '100644 abcdef\tsrc/core.ts\0' },
  ])('rejects a $label at the Git process boundary', async ({ mode, stdout }) => {
    const f = await setup({ malformedStagedIndex: mode })
    const originalSpawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess)
    vi.spyOn(f.ctx.subprocess, 'spawn').mockImplementation(spec => spec.cwd === f.alphaPath && spec.argv.includes('--stage')
      ? completedHandle({ exitCode: 0, stdout: { text: stdout, lossy: false } })
      : originalSpawn(spec))
    const before = await Promise.all([f.alphaPath, f.betaPath].map(snapshotRepository))
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], `inspect ${mode}`)
    const indexErrors = [...f.childAgents.values()].flatMap(child => child.session.snapshotEvents()
      .filter(event => event.type === 'tool/result' && event.data.error !== undefined)
      .flatMap(event => event.type === 'tool/result' ? [event.data.error?.code] : []))
    expect(indexErrors).toContain('GIT_INDEX_INVALID')
    const rows = (result as { repositories: readonly Record<string, unknown>[] }).repositories
    expect(rows[0]).toMatchObject({ workspaceId: 'workspace-alpha', execution: 'result' })
    expect(rows[1]).toMatchObject({ workspaceId: 'workspace-beta', execution: 'result' })
    expect(await Promise.all([f.alphaPath, f.betaPath].map(snapshotRepository))).toEqual(before)
  }, 30_000)

  it('reports startup failures independently and keeps child identities unset', async () => {
    const f = await setup()
    const start = vi.spyOn(f.ctx.subagents, 'startActivation')
      .mockRejectedValueOnce(new Error('alpha provider unavailable'))
      .mockRejectedValueOnce('beta provider unavailable')
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect with failing workers')
    const rows = (result as { repositories: readonly Record<string, unknown>[] }).repositories
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      execution: 'startup-error', workspaceId: 'workspace-alpha',
      childSessionId: null, runId: null, stopReason: 'alpha provider unavailable', assistantOutput: 'alpha provider unavailable',
    })
    expect(rows[1]).toMatchObject({
      execution: 'startup-error', workspaceId: 'workspace-beta',
      childSessionId: null, runId: null, stopReason: 'beta provider unavailable', assistantOutput: 'beta provider unavailable',
    })
    expect(f.starts).toEqual([])

    start.mockRejectedValueOnce(new HarnessError('alpha provider denied start', 'ALPHA_START_DENIED'))
      .mockRejectedValueOnce(new Error('beta provider failed before publication'))
    const typedFailures = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect with typed startup failures')
    const typedRows = (typedFailures as { repositories: readonly Record<string, unknown>[] }).repositories
    expect(typedRows[0]).toMatchObject({ stopReason: 'ALPHA_START_DENIED', assistantOutput: 'alpha provider denied start' })
    expect(typedRows[1]).toMatchObject({ stopReason: 'beta provider failed before publication' })
  }, 30_000)

  it('omits reasoning-only child output', async () => {
    const f = await setup()
    vi.spyOn(f.ctx.subagents, 'startActivation').mockImplementation(async (request): Promise<SubagentActivation> => ({
      childId: request.childId ?? SessionId('non-text-child'),
      name: 'non-text-result',
      result: Promise.resolve({
        stopReason: 'completed',
        output: [{ type: 'reasoning', text: 'analysis is not user-facing evidence' }],
      }),
      dispose: async () => {},
    }))
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect without text findings')
    const rows = (result as { repositories: readonly Record<string, unknown>[] }).repositories
    expect(rows.every(row => row.childSessionId !== null && row.runId === null && row.assistantOutput === '')).toBe(true)
  }, 30_000)

  it('records cleanup failures without replacing completed worker findings', async () => {
    const f = await setup()
    failFirstChildDispose(f)
    const result = await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect with cleanup warning')
    const rows = (result as { repositories: readonly Record<string, unknown>[] }).repositories
    expect(rows[0]).toMatchObject({ execution: 'result', workspaceId: 'workspace-alpha' })
    expect(rows[1]).toMatchObject({ execution: 'result', workspaceId: 'workspace-beta' })
    expect(rows.every(row => String(row.assistantOutput).includes('Worker cleanup failed: cleanup fixture failure'))).toBe(true)
    expect(f.ends).toHaveLength(2)
  }, 30_000)

  it('aborts final source observation and waits for worker cleanup', async () => {
    const f = await setup()
    const abort = new AbortController()
    const originalSpawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess)
    let headReads = 0
    vi.spyOn(f.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('rev-parse') && spec.argv.at(-1) === 'HEAD' && ++headReads === 3) abort.abort()
      return originalSpawn(spec)
    })
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'abort final state check', abort.signal))
      .rejects.toThrow(/aborted/iu)
    expect(headReads).toBeGreaterThanOrEqual(3)
    expect(f.starts).toHaveLength(2)
    expect(f.ends).toHaveLength(2)
  }, 30_000)

  it('disposes a child when cancellation arrives as startup completes', async () => {
    const f = await setup()
    const abort = new AbortController()
    const start = f.ctx.subagents.startActivation.bind(f.ctx.subagents)
    let aborted = false
    vi.spyOn(f.ctx.subagents, 'startActivation').mockImplementation(async (request) => {
      const activation = await start(request)
      if (!aborted) {
        aborted = true
        abort.abort()
      }
      return activation
    })
    await expect(authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'cancel child startup', abort.signal))
      .rejects.toThrow(/aborted/iu)
    expect(aborted).toBe(true)
    await vi.waitFor(() => { expect(f.ends).toHaveLength(f.starts.length) }, { timeout: 30_000, interval: 20 })
    expect(f.starts.length).toBeGreaterThan(0)
  }, 30_000)

  it('starts a worker with a fallback label and an explicit no-root-instructions result', async () => {
    const f = await setup({ noAlphaRootInstructions: true, betaTitle: '' })
    await git(f.betaPath, ['checkout', '--detach', 'HEAD'])
    const start = vi.spyOn(f.ctx.subagents, 'startActivation')
    await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], 'inspect root instruction behavior')
    expect(start.mock.calls.map(([request]) => request.label)).toContain('repo-analysis')
    expect(f.adapter.requests.some(request => JSON.stringify(request.messages).includes('branch: (detached)'))).toBe(true)
    const alphaRequest = f.adapter.requests.find(request => request.sessionId !== f.parentId
      && JSON.stringify(request.messages).includes('No root AGENTS.md or CLAUDE.md instructions were found.'))
    expect(alphaRequest).toBeDefined()
  }, 30_000)

  it.each(['ignored', 'directory', 'oversized', 'outside-link', 'claude'] as const)(
    'handles %s repository root instructions without reading outside Alpha', async (mode) => {
      const f = await setup({ alphaRootMode: mode })
      if (mode === 'outside-link') {
        const originalLstat = f.ctx.fs.lstat.bind(f.ctx.fs)
        vi.spyOn(f.ctx.fs, 'lstat').mockImplementation(async (path, options, signal) => {
          const info = await originalLstat(path, options, signal)
          return path === join(f.alphaPath, 'AGENTS.md') && info !== undefined
            ? { ...info, type: 'file' }
            : info
        })
      }
      await authorizeDirectCoordination(f, [f.alphaPath, f.betaPath], `inspect ${mode} root instructions`)
      const alphaRequest = f.adapter.requests.find(request => request.sessionId !== f.parentId
        && JSON.stringify(request.messages).includes(mode === 'claude'
          ? 'ALPHA CLAUDE INSTRUCTIONS'
          : 'No root AGENTS.md or CLAUDE.md instructions were found.'))
      expect(alphaRequest).toBeDefined()
      if (mode === 'outside-link') {
        expect(JSON.stringify(alphaRequest?.messages)).not.toContain('THIRD REPOSITORY CONTENT')
      }
    },
    30_000,
  )

  it('compares canonical duplicate roots using the non-Windows path rule', async () => {
    const f = await setup()
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    if (descriptor === undefined) throw new Error('process.platform descriptor is unavailable')
    try {
      Object.defineProperty(process, 'platform', { ...descriptor, value: 'linux' })
      await expect(f.parent.ctx.waterfall(
        'tools/pre-execute',
        directToolContext('coordinate_repositories', {
          repositories: [f.alphaPath, f.alphaPath], task: 'select one root twice',
        }, f.parent),
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      )).resolves.toMatchObject({ kind: 'deny', reason: 'select two distinct registered Workspace roots' })
    } finally {
      Object.defineProperty(process, 'platform', descriptor)
    }
  }, 30_000)

  it('cancels both child runs and waits for their lifecycle cleanup', async () => {
    const f = await setup({ hangChildren: true })
    failEveryChildDispose(f)
    f.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Inspect Alpha and Beta.' }], source: { kind: 'user' },
    }))
    await vi.waitFor(() => { expect(f.adapter.requests).toHaveLength(3) }, { timeout: 30_000, interval: 10 })
    const child = [...f.childAgents.values()][0]
    expect(child).toBeDefined()
    if (child !== undefined) {
      expect(await child.ctx.waterfall(
        'tools/pre-execute',
        directToolContext('bash', { command: 'write outside' }, child),
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      )).toMatchObject({ kind: 'deny' })
    }
    f.parent.cancel({ kind: 'user' })
    await f.parent.whenIdle()
    expect(f.starts).toHaveLength(2)
    expect(f.ends).toHaveLength(2)
    expect(f.ctx.agents.get(SessionId(f.starts[0]?.id ?? 'missing'))).toBeUndefined()
  }, 30_000)

  it.each([
    {
      providerName: 'missing-read-only-capability',
      capabilities: { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false, readOnly: false, toolFilter: true },
      inheritsParentContext: false,
    },
    {
      providerName: 'inherits-parent-context',
      capabilities: { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false, readOnly: true, toolFilter: true },
      inheritsParentContext: true,
    },
  ])('rejects read-only delegation through provider $providerName', async ({ providerName, capabilities, inheritsParentContext }) => {
    const f = await setup()
    const unregisterProvider = f.ctx.subagents.registerProvider({
      name: providerName,
      capabilities,
      inheritsParentContext,
      prepareContinuable: async () => ({}),
    })
    f.ctx.effect(() => unregisterProvider)
    await expect(f.ctx.subagents.startActivation({
      provider: providerName,
      label: 'read-only provider rejection',
      prompt: [{ type: 'text', text: 'Do not start an unsupported read-only child.' }],
      parent: f.parent,
      signal: new AbortController().signal,
      delivery: 'caller',
      readOnly: true,
      toolFilter: { allow: REPO_READ_TOOLS },
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(f.starts).toEqual([])
  }, 30_000)

  it('keeps ordinary single-repository in-process delegation working', async () => {
    const f = await setup()
    const coordinationAttempts: Promise<unknown>[] = []
    const stopObservation = f.ctx.on('subagent/start', ({ id }) => {
      const child = f.ctx.agents.get(id)
      if (child === undefined) return
      const tool = f.ctx.tools.get('coordinate_repositories')
      if (tool === undefined) throw new Error('coordinator tool missing')
      coordinationAttempts.push(tool.execute(
        { repositories: [f.alphaPath, f.betaPath], task: 'child attempt' },
        directToolContext('coordinate_repositories', {}, child),
      ).then(() => undefined, (error: unknown) => error))
    })
    const activation = await f.ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'ordinary single-repository task',
      name: 'single-repository-worker',
      prompt: [{ type: 'text', text: 'ORDINARY SINGLE-REPOSITORY TASK: return a short result.' }],
      parent: f.parent,
      signal: new AbortController().signal,
      delivery: 'caller',
    })
    const result = await activation.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'ordinary single-repository child completed' }])
    expect(f.starts).toHaveLength(1)
    expect(f.starts[0]?.runId).toBeTruthy()
    expect(coordinationAttempts).toHaveLength(1)
    expect(await coordinationAttempts[0]).toMatchObject({ code: 'DELEGATED_COORDINATION_DENIED' })
    stopObservation()
    await activation.dispose()
  }, 30_000)
})

async function initializeRepository(path: string, branch: string, instruction: string): Promise<string> {
  await mkdir(join(path, 'src'), { recursive: true })
  await writeFile(join(path, 'AGENTS.md'), `${instruction}\n`)
  await writeFile(join(path, 'src', 'AGENTS.md'), `${instruction} NESTED\n`)
  const repo = branch.startsWith('analysis') ? 'alpha' : branch.startsWith('release') ? 'beta' : 'third'
  await writeFile(join(path, 'src', 'core.ts'), `export const value = "base-${repo}"\n`)
  await writeFile(join(path, 'src', 'draft.ts'), `draft-${repo}\n`)
  await writeFile(join(path, '.gitignore'), '.env\n*.ignored\n')
  await writeFile(join(path, '.env'), 'fixture-private-secret\n')
  await writeFile(join(path, 'cache.ignored'), 'ignored-content\n')
  await git(path, ['init', '--initial-branch', branch])
  await git(path, ['add', '--', 'AGENTS.md', 'src/AGENTS.md', 'src/core.ts', '.gitignore'])
  await git(path, ['-c', 'user.name=DSH fixture', '-c', 'user.email=dsh-fixture@example.invalid', 'commit', '--no-gpg-sign', '-m', 'initial'])
  await writeFile(join(path, 'src', 'core.ts'), `export const value = "staged-${repo}"\n`)
  await git(path, ['add', '--', 'src/core.ts'])
  await writeFile(join(path, 'src', 'core.ts'), `export const value = "working-${repo}"\n`)
  return (await git(path, ['rev-parse', 'HEAD'])).trim()
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
  const hooksPath = windows ? 'NUL' : '/dev/null'
  const result = await execFileAsync('git', ['-c', `core.hooksPath=${hooksPath}`, ...args], { cwd, env })
  return result.stdout
}

async function snapshotRepository(root: string): Promise<Record<string, string>> {
  const paths = [
    'AGENTS.md', 'src/AGENTS.md', 'src/core.ts', 'src/draft.ts', '.gitignore', '.env', 'cache.ignored',
    'private.pem', 'binary.bin', 'large.bin',
  ]
  const files = await Promise.all(paths.map(async (path) => {
    try { return [path, (await readFile(join(root, path))).toString('base64')] as const }
    catch (error) {
      if (isMissing(error)) return [path, '<missing>'] as const
      throw error
    }
  }))
  return {
    ...Object.fromEntries(files),
    index: (await readFile(join(root, '.git', 'index'))).toString('base64'),
    branch: (await git(root, ['branch', '--show-current'])).trim(),
    status: await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function workspaceRecord(id: string, title: string, path: string): Workspace {
  return {
    id: WorkspaceId(id), path, title, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    sessionIds: [], setTitle: async () => {}, attachSession: async () => {}, detachSession: async () => {},
    insertSessionBefore: async () => {},
    status: async (): Promise<'ok'> => 'ok',
  }
}

function directToolContext(
  name: string,
  argumentsValue: unknown,
  agent?: Agent,
  callId = ToolCallId(`direct-${randomUUID()}`),
  signal = new AbortController().signal,
): ToolRunContext {
  return {
    name,
    callId,
    rootCallId: callId,
    arguments: argumentsValue,
    ...(agent === undefined ? {} : { agent }),
    signal,
    token: Symbol(name) as ToolExecutionToken,
    deferContext() {},
    concludeTurn() {},
  }
}

function completedHandle(options: {
  readonly exitCode: number | null
  readonly signal?: NodeJS.Signals | null
  readonly stdout?: { readonly text: string; readonly lossy: boolean }
  readonly stderr?: { readonly text: string; readonly lossy: boolean }
}): SubprocessHandle {
  const reader = (output: { readonly text: string; readonly lossy: boolean }) => ({
    readFrom: () => ({ text: output.text, nextOffset: Buffer.byteLength(output.text), lossy: output.lossy }),
  })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      ...(options.stdout === undefined ? {} : { stdout: reader(options.stdout) }),
      ...(options.stderr === undefined ? {} : { stderr: reader(options.stderr) }),
    },
    done: Promise.resolve({ exitCode: options.exitCode, signal: options.signal ?? null }),
    terminate() {},
    waitForExit: async () => true,
  }
}

async function authorizeDirectCoordination(
  fixture: Fixture,
  repositories: readonly [string, string],
  task: string,
  signal = new AbortController().signal,
): Promise<unknown> {
  const tool = fixture.ctx.tools.get('coordinate_repositories')
  if (tool === undefined) throw new Error('coordinate_repositories tool is not mounted')
  const args = { repositories, task }
  const execution = directToolContext(
    'coordinate_repositories', args, fixture.parent, ToolCallId(`approved-${randomUUID()}`), signal,
  )
  const decision = await fixture.parent.ctx.waterfall(
    'tools/pre-execute', execution, () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
  )
  expect(decision).toMatchObject({ kind: 'ask' })
  return tool.execute(args, execution)
}

function failFirstChildDispose(fixture: Fixture): void {
  const start = fixture.ctx.subagents.startActivation.bind(fixture.ctx.subagents)
  vi.spyOn(fixture.ctx.subagents, 'startActivation').mockImplementation(async (request) => {
    const activation = await start(request)
    let fail = true
    return {
      ...activation,
      async dispose() {
        await activation.dispose()
        if (fail) {
          fail = false
          throw new Error('cleanup fixture failure')
        }
      },
    }
  })
}

function failEveryChildDispose(fixture: Fixture): void {
  const start = fixture.ctx.subagents.startActivation.bind(fixture.ctx.subagents)
  vi.spyOn(fixture.ctx.subagents, 'startActivation').mockImplementation(async (request) => {
    const activation = await start(request)
    return {
      ...activation,
      async dispose() {
        await activation.dispose()
        throw new Error('cleanup fixture failure')
      },
    }
  })
}

function toolCallsResponse(calls: readonly { readonly id: string; readonly name: string; readonly args: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const callId = ToolCallId(call.id)
    const argumentsJson = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: callId, name: call.name, argumentsDelta: argumentsJson.slice(0, 8) },
      { type: 'tool-call-delta', index, id: callId, argumentsDelta: argumentsJson.slice(8) },
      { type: 'block-end', index, block: { type: 'tool-call', id: callId, name: call.name, arguments: argumentsJson } },
    )
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: calls.length * 5 } })
  chunks.push({ type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}
