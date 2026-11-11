/** Read-only coordination of one analysis task across two selected Git Workspaces. @module */

import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolExecution, JsonSchemaNode, PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { assertReadOnlyGitCommand, gitNullDevice } from './read-only-git-command.ts'

/** Cordis plugin name used by Loader composition. */
export const name = 'tool-multi-repository'
/** Services used to inspect registered repositories and run scoped child Sessions. */
export const inject = ['tools', 'agents', 'workspaceRegistry', 'subagents', 'sandbox', 'subprocess', 'fs', 'agentPresets']

/** Read-only child composition used by repository analysis. */
export interface Config {
  /** Persona-only preset mounted for read-only repository analysis. */
  readonly readOnlyAgentPreset: string
  /** In-process DSH provider that supports a pinned read-only child policy. */
  readonly providerName: string
}

/** Resolved plugin configuration. */
export const Config = z.object({
  readOnlyAgentPreset: z.string().default('multi-repository-read-only'),
  providerName: z.string().default('spawn'),
})

const TOOL_NAME = 'coordinate_repositories'
const STAGED_READ_TOOL = 'read_staged_file'
const MAX_GIT_OUTPUT_BYTES = 512 * 1024
const MAX_UNTRACKED_FILES = 500
const MAX_STATUS_PATHS = 120
const MAX_INSTRUCTION_BYTES = 16 * 1024
const MAX_READ_FILE_BYTES = 1024 * 1024
const MAX_READ_LINES = 400
const SAFE_PRESET_MODULES = new Set(['@deepseek-ai/dsh-persona'])
const READ_ONLY_TOOLS = ['repository_list_files', 'repository_read_file', STAGED_READ_TOOL] as const

interface RegisteredSelection {
  readonly workspace: Workspace
  readonly root: string
}

interface ApprovedSelection {
  readonly repositories: readonly [
    { readonly workspaceId: string; readonly root: string; readonly title: string },
    { readonly workspaceId: string; readonly root: string; readonly title: string },
  ]
  readonly task: string
}

interface GitCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly enforcement: SandboxEnforcement
}

interface SourceState {
  readonly gitCommandEnforcement: SandboxEnforcement
  readonly head: string
  readonly branch: string | null
  readonly stagedPaths: readonly string[]
  readonly unstagedPaths: readonly string[]
  readonly untrackedPaths: readonly string[]
  readonly stagedCount: number
  readonly unstagedCount: number
  readonly untrackedCount: number
  readonly ignoredPathCount: number
  readonly signature: string
}

interface RepositorySource extends RegisteredSelection {
  readonly commonGitDirectory: string
  readonly state: SourceState
  readonly rootInstructions: string
}

interface RepositoryResult {
  readonly execution: 'result' | 'startup-error' | 'result-error'
  readonly gitCommandEnforcement: SandboxEnforcement
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly root: string
  readonly gitIdentity: string
  readonly head: string
  readonly branch: string | null
  readonly stagedPaths: readonly string[]
  readonly unstagedPaths: readonly string[]
  readonly untrackedPaths: readonly string[]
  readonly stagedCount: number
  readonly unstagedCount: number
  readonly untrackedCount: number
  readonly ignoredPathCount: number
  readonly childSessionId: string | null
  readonly runId: string | null
  readonly stopReason: string
  readonly assistantOutput: string
  readonly sourceChanged: boolean | null
  readonly observedAtStart: string
  readonly observedAtEnd: string | null
  readonly observationError: string | null
}

interface ToolArgs {
  readonly repositories: readonly [string, string]
  readonly task: string
}

/** Structured failure returned by repository inspection. */
class MultiRepositoryError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'MultiRepositoryError'
  }
}

const resultSchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['repositories'],
  properties: {
    repositories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'execution', 'gitCommandEnforcement', 'workspaceId', 'workspaceTitle', 'root', 'gitIdentity', 'head', 'branch',
          'stagedPaths', 'unstagedPaths', 'untrackedPaths', 'ignoredPathCount', 'childSessionId',
          'stagedCount', 'unstagedCount', 'untrackedCount',
          'runId', 'stopReason', 'assistantOutput', 'sourceChanged', 'observedAtStart',
          'observedAtEnd', 'observationError',
        ],
        properties: {
          execution: { type: 'string', enum: ['result', 'startup-error', 'result-error'] },
          gitCommandEnforcement: { type: 'string', enum: ['full', 'partial'] },
          workspaceId: { type: 'string' },
          workspaceTitle: { type: 'string' },
          root: { type: 'string' },
          gitIdentity: { type: 'string' },
          head: { type: 'string' },
          branch: nullableStringSchema(),
          stagedPaths: stringArraySchema(),
          unstagedPaths: stringArraySchema(),
          untrackedPaths: stringArraySchema(),
          stagedCount: { type: 'integer' },
          unstagedCount: { type: 'integer' },
          untrackedCount: { type: 'integer' },
          ignoredPathCount: { type: 'integer' },
          childSessionId: nullableStringSchema(),
          runId: nullableStringSchema(),
          stopReason: { type: 'string' },
          assistantOutput: { type: 'string' },
          sourceChanged: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
          observedAtStart: { type: 'string' },
          observedAtEnd: nullableStringSchema(),
          observationError: nullableStringSchema(),
        },
      },
    },
  },
}

function nullableStringSchema(): JsonSchemaNode {
  return { oneOf: [{ type: 'string' }, { type: 'null' }] }
}

function stringArraySchema(): JsonSchemaNode {
  return { type: 'array', items: { type: 'string' } }
}

function createCoordinationTool(
  ctx: Context,
  config: Config,
  approvals: Map<ToolCallId, ApprovedSelection>,
  workerRoots: Map<string, string>,
  workerRunIds: Map<string, string>,
): ToolDefinition {
  return {
    name: TOOL_NAME,
    description: [
      'Coordinate one read-only analysis across exactly two explicitly selected registered local Git Workspaces.',
      'DSH starts one fresh read-only child Session per repository and returns separate findings with repository identity,',
      'branch, committed revision, staged, unstaged, untracked and ignored state, child Session and run attribution.',
      'Workers inspect the live working trees; the result reports if source state changed during analysis.',
      'A user must approve the exact repository selection and task before repository contents are inspected.',
    ].join(' '),
    parameters: {
      repositories: {
        type: 'array', required: true, minItems: 2, maxItems: 2,
        items: { type: 'string', description: 'Absolute root path of one registered Workspace.' },
        description: 'Exactly two absolute registered Workspace roots, in result order.',
      },
      task: {
        type: 'string', required: true,
        description: 'One analysis task to perform independently in each repository.',
      },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: renderRepositoryResults(value) }],
      presentationMeta: (_args, value) => ({
        repositories: repositoryRows(value).map(row => ({
          workspaceId: row.workspaceId,
          root: row.root,
          head: row.head,
          execution: row.execution,
          childSessionId: row.childSessionId,
          runId: row.runId,
          sourceChanged: row.sourceChanged,
        })),
      }),
    },
    async execute(rawArgs, exec) {
      const args = rawArgs as ToolArgs
      const parent = exec.agent
      if (parent === undefined || ctx.agents.get(parent.id) !== parent || parent.ctx.fiber.state !== FiberState.ACTIVE) {
        throw new MultiRepositoryError('repository coordination requires a live parent Agent', 'PARENT_UNAVAILABLE')
      }
      if (parent.session.header.parentSession !== undefined) {
        throw new MultiRepositoryError('repository coordination is available only to a user-started conversation', 'DELEGATED_COORDINATION_DENIED')
      }
      const approved = approvals.get(exec.callId)
      approvals.delete(exec.callId)
      if (approved === undefined || approved.task !== args.task) {
        throw new MultiRepositoryError('repository coordination requires one-shot approval for this task and repository selection', 'READ_AUTHORIZATION_REQUIRED')
      }
      assertSafeReadOnlyPreset(ctx.agentPresets, config.readOnlyAgentPreset)

      const selected = await Promise.all(args.repositories.map(
        path => resolveRegisteredSelection(ctx.fs, ctx.workspaceRegistry, path, exec.signal),
      ))
      const [firstSelection, secondSelection] = selected as [RegisteredSelection, RegisteredSelection]
      const firstApproved = approved.repositories[0]
      const secondApproved = approved.repositories[1]
      if (!matchesApproval(firstSelection, firstApproved) || !matchesApproval(secondSelection, secondApproved)) {
        throw new MultiRepositoryError('a selected Workspace changed while read access approval was pending; ask again', 'APPROVED_REPOSITORY_CHANGED')
      }

      const sources = await Promise.all(selected.map(selection => inspectSource(ctx, selection, exec.signal)))
      const [firstSource, secondSource] = sources as [RepositorySource, RepositorySource]
      if (await sameRepository(ctx.fs, firstSource, secondSource)) {
        throw new MultiRepositoryError('the selected Workspaces resolve to the same Git repository identity', 'DUPLICATE_REPOSITORY')
      }

      const settled = await Promise.allSettled(sources.map(source => runRepositoryWorker(
        ctx,
        config,
        parent,
        source,
        args.task,
        exec.signal,
        workerRoots,
        workerRunIds,
      )))
      const results: RepositoryResult[] = []
      for (const result of settled) {
        if (result.status === 'rejected') throw result.reason
        results.push(result.value)
      }
      exec.signal.throwIfAborted()
      return { repositories: results }
    },
  }
}

function createStagedReadTool(
  ctx: Context,
  workerRoots: Map<string, string>,
): ToolDefinition {
  return {
    name: STAGED_READ_TOOL,
    description: 'Read the staged Git index version of one file without changing the index or working tree.',
    parameters: {
      path: { type: 'string', required: true, description: 'One repository-relative file path.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['path', 'stage', 'content'],
        properties: {
          path: { type: 'string' }, stage: { type: 'integer' }, content: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStagedContent(value) }],
    },
    async execute(rawArgs, exec) {
      const args = rawArgs as { readonly path: string }
      const root = exec.agent === undefined ? undefined : repositoryWorkerRoot(exec.agent, workerRoots)
      if (root === undefined) throw new MultiRepositoryError('staged file reads are available only to an active repository worker', 'REPOSITORY_WORKER_REQUIRED')
      const gitPath = normalizeRepositoryRelativePath(root, args.path)
      if (isSensitivePath(gitPath)) throw new MultiRepositoryError('secret-like files are excluded from repository analysis', 'SECRET_PATH_DENIED')
      if (await isIgnoredPath(ctx, root, gitPath, exec.signal)) throw new MultiRepositoryError('ignored files are excluded from repository analysis', 'IGNORED_PATH_DENIED')
      const entries = await runGit(ctx, root, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', gitPath], exec.signal)
      const parsed = parseIndexEntries(entries.stdout)
      const entry = parsed[0]
      if (entry === undefined || parsed.length !== 1 || normalizeGitPath(entry.path) !== normalizeGitPath(gitPath)) {
        throw new MultiRepositoryError('the requested path does not identify one staged index entry', 'STAGED_ENTRY_UNAVAILABLE')
      }
      const blob = await runGit(ctx, root, ['cat-file', 'blob', entry.objectId], exec.signal, { maxStdoutBytes: 128 * 1024 })
      if (blob.stdout.includes('\0')) throw new MultiRepositoryError('binary staged content cannot be returned as text', 'STAGED_CONTENT_BINARY')
      const lines = blob.stdout.split(/\r?\n/u).slice(0, 400).map((line, index) => `${index + 1}: ${line}`)
      return { path: gitPath, stage: entry.stage, content: lines.join('\n') }
    },
  }
}

function createListFilesTool(
  ctx: Context,
  workerRoots: Map<string, string>,
): ToolDefinition {
  return {
    name: 'repository_list_files',
    description: 'List tracked and unignored untracked paths in this selected repository; ignored files are omitted.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['paths', 'totalFiles', 'omittedSensitiveFiles'],
        properties: {
          paths: stringArraySchema(),
          totalFiles: { type: 'integer' },
          omittedSensitiveFiles: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderFileList(value) }],
    },
    async execute(_args, exec) {
      const root = exec.agent === undefined ? undefined : repositoryWorkerRoot(exec.agent, workerRoots)
      if (root === undefined) throw new MultiRepositoryError('file listing is available only to a repository worker', 'REPOSITORY_WORKER_REQUIRED')
      const result = await runGit(ctx, root, ['--literal-pathspecs', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--'], exec.signal)
      const paths = splitGitPaths(result.stdout)
      const safe = paths.filter(path => !isSensitivePath(path) && !isGitMetadataPath(path))
      return {
        paths: safe.slice(0, 500),
        totalFiles: safe.length,
        omittedSensitiveFiles: paths.length - safe.length,
      }
    },
  }
}

function createWorkingTreeReadTool(
  ctx: Context,
  workerRoots: Map<string, string>,
): ToolDefinition {
  return {
    name: 'repository_read_file',
    description: 'Read one bounded file from this selected repository working tree.',
    parameters: {
      path: { type: 'string', required: true, description: 'One path relative to the selected repository root.' },
      offset: { type: 'number', description: '1-based first line to return; defaults to 1.' },
      limit: { type: 'number', description: `Maximum lines to return; defaults to ${MAX_READ_LINES}.` },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['path', 'offset', 'lines', 'totalLines'],
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer' },
          totalLines: { type: 'integer' },
          lines: {
            type: 'array', items: {
              type: 'object', additionalProperties: false,
              required: ['number', 'text'],
              properties: { number: { type: 'integer' }, text: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWorkingTreeFile(value) }],
    },
    async execute(rawArgs, exec) {
      const args = rawArgs as { readonly path: string; readonly offset?: number; readonly limit?: number }
      const root = exec.agent === undefined ? undefined : repositoryWorkerRoot(exec.agent, workerRoots)
      if (root === undefined) throw new MultiRepositoryError('file reads are available only to a repository worker', 'REPOSITORY_WORKER_REQUIRED')
      const requested = normalizeRepositoryRelativePath(root, args.path)
      if (isSensitivePath(requested) || isGitMetadataPath(requested)) {
        throw new MultiRepositoryError('secret files and Git metadata are excluded from repository analysis', 'PROTECTED_PATH_DENIED')
      }
      if (await isIgnoredPath(ctx, root, requested, exec.signal)) {
        throw new MultiRepositoryError('ignored files are excluded from repository analysis', 'IGNORED_PATH_DENIED')
      }
      const target = await ctx.fs.resolve(requested, { cwd: root, signal: exec.signal })
      const rootTarget = await ctx.fs.resolve(root, { signal: exec.signal })
      if (!ctx.fs.contains(rootTarget, target)) throw new MultiRepositoryError('repository workers cannot read outside their selected Workspace', 'OUTSIDE_REPOSITORY')
      const canonicalPath = relative(root, ctx.fs.processPath(target))
      if (isSensitivePath(canonicalPath) || isGitMetadataPath(canonicalPath)) {
        throw new MultiRepositoryError('secret files and Git metadata are excluded from repository analysis', 'PROTECTED_PATH_DENIED')
      }
      const info = await ctx.fs.stat(target, exec.signal)
      if (info?.type !== 'file') throw new MultiRepositoryError('repository read requires one regular file', 'FILE_NOT_FOUND')
      if (info.size !== undefined && info.size > MAX_READ_FILE_BYTES) throw new MultiRepositoryError('file exceeds the repository analysis read limit', 'FILE_TOO_LARGE')
      const offset = positiveLineNumber(args.offset, 1, 'offset')
      const limit = positiveLineNumber(args.limit, MAX_READ_LINES, 'limit')
      if (limit > MAX_READ_LINES) throw new MultiRepositoryError(`limit must be at most ${MAX_READ_LINES}`, 'INVALID_READ_LIMIT')
      const content = await ctx.fs.readText(target, exec.signal)
      const allLines = content.split(/\r?\n/u)
      const lines = allLines.slice(offset - 1, offset - 1 + limit).map((text, index) => ({ number: offset + index, text }))
      return { path: normalizeGitPath(canonicalPath), offset, lines, totalLines: allLines.length }
    },
  }
}

/** Register model tools and enforce selected-root reads for every worker tool call. */
export function apply(ctx: Context, config: Config): void {
  const approvals = new Map<ToolCallId, ApprovedSelection>()
  const workerRoots = new Map<string, string>()
  const workerRunIds = new Map<string, string>()
  ctx.effect(() => ctx.tools.register(createCoordinationTool(ctx, config, approvals, workerRoots, workerRunIds)))
  const whenWorker = { when: ({ agent }: { readonly agent: NonNullable<ToolExecution['agent']> }) => isRepositoryWorker(agent, workerRoots) }
  ctx.effect(() => ctx.tools.register(createListFilesTool(ctx, workerRoots), whenWorker))
  ctx.effect(() => ctx.tools.register(createWorkingTreeReadTool(ctx, workerRoots), whenWorker))
  ctx.effect(() => ctx.tools.register(createStagedReadTool(ctx, workerRoots), whenWorker))
  ctx.effect(() => {
    const stopBeforeExecute = ctx.on('tools/pre-execute', async (execution, next) => {
      if (execution.name === TOOL_NAME) {
        if (execution.agent === undefined || execution.agent.session.header.parentSession !== undefined) return next()
        return repositoryReadApprovalDecision(ctx, execution, approvals)
      }
      const root = execution.agent === undefined
        ? undefined
        : repositoryWorkerRoot(execution.agent, workerRoots)
      if (root === undefined) return next()
      return enforceWorkerTool(execution)
    })
    const stopAfterResult = ctx.on('tools/result', (execution) => {
      if (execution.name === TOOL_NAME) approvals.delete(execution.callId)
    })
    const stopOnChildStart = ctx.on('subagent/start', ({ id, runId }) => {
      if (workerRoots.has(String(id))) workerRunIds.set(String(id), String(runId))
    })
    return () => {
      approvals.clear()
      workerRoots.clear()
      workerRunIds.clear()
      stopBeforeExecute()
      stopAfterResult()
      stopOnChildStart()
    }
  })
}

async function repositoryReadApprovalDecision(
  ctx: Context,
  execution: ToolExecution,
  approvals: Map<ToolCallId, ApprovedSelection>,
): Promise<PreToolDecision> {
  const args = readToolArgs(execution.arguments)
  if (args === undefined) return { kind: 'deny', reason: 'select exactly two registered Workspace roots and provide one analysis task' }
  const selections = await Promise.all(args.repositories.map(path => resolveRegisteredSelection(
    ctx.fs, ctx.workspaceRegistry, path, execution.signal,
  )))
  const [first, second] = selections as [RegisteredSelection, RegisteredSelection]
  if (samePath(first.root, second.root)) return { kind: 'deny', reason: 'select two distinct registered Workspace roots' }
  const approved: ApprovedSelection = {
    repositories: [
      { workspaceId: String(first.workspace.id), root: first.root, title: first.workspace.title },
      { workspaceId: String(second.workspace.id), root: second.root, title: second.workspace.title },
    ],
    task: args.task,
  }
  approvals.set(execution.callId, approved)
  const selection = approved.repositories.map(repository => `${repository.title} (${repository.workspaceId}; ${repository.root})`)
  const reason = `Read-only analysis of selected repositories ${JSON.stringify(selection)} for task ${JSON.stringify(args.task)}`
  return {
    kind: 'ask',
    reason,
    displayReason: {
      en: [
        'Allow one read-only analysis of these two repositories?',
        `Repository 1: ${selection[0]}`,
        `Repository 2: ${selection[1]}`,
        `Task: ${args.task}`,
        'This approval grants no write, shell, process, child-delegation, or sandbox-mode-change capability.',
      ].join('\n'),
      zh: [
        '是否允许只读分析以下两个仓库？',
        `仓库 1：${selection[0]}`,
        `仓库 2：${selection[1]}`,
        `任务：${args.task}`,
        '此批准不授予写入、Shell、进程、子代理委派或更改沙箱模式的能力。',
      ].join('\n'),
    },
  }
}

function readToolArgs(value: unknown): ToolArgs | undefined {
  if (!isRecord(value) || !Array.isArray(value.repositories) || value.repositories.length !== 2) return undefined
  const first: unknown = value.repositories[0]
  const second: unknown = value.repositories[1]
  const task: unknown = value.task
  if (typeof first !== 'string' || typeof second !== 'string' || typeof task !== 'string' || task.trim().length === 0) return undefined
  return { repositories: [first, second], task }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function resolveRegisteredSelection(
  fs: FileSystem,
  registry: WorkspaceRegistry,
  requestedPath: string,
  signal: AbortSignal,
): Promise<RegisteredSelection> {
  if (!isAbsolute(requestedPath)) throw new MultiRepositoryError('selected Workspace paths must be absolute', 'WORKSPACE_NOT_SELECTED')
  const target = await fs.resolve(requestedPath, { signal })
  const root = fs.processPath(target)
  const workspace = await findRegisteredWorkspace(fs, registry.list(), root, signal)
  if (workspace === undefined) throw new MultiRepositoryError(`path is not a registered Workspace: ${JSON.stringify(requestedPath)}`, 'WORKSPACE_NOT_SELECTED')
  const hostPath = fs.processPathFromHostPath(workspace.path)
  if (hostPath === undefined || !samePath(hostPath, root)) {
    throw new MultiRepositoryError('repository workers require a local filesystem shared with the subprocess provider', 'LOCAL_FILESYSTEM_REQUIRED')
  }
  const info = await fs.stat(target, signal)
  if (info?.type !== 'directory') throw new MultiRepositoryError('selected Workspace must be an existing directory', 'WORKSPACE_NOT_SELECTED')
  return { workspace, root }
}

async function findRegisteredWorkspace(
  fs: FileSystem,
  workspaces: readonly Workspace[],
  root: string,
  signal: AbortSignal,
): Promise<Workspace | undefined> {
  for (const workspace of workspaces) {
    const target = await fs.resolve(workspace.path, { signal })
    if (samePath(fs.processPath(target), root)) return workspace
  }
  return undefined
}

function matchesApproval(selection: RegisteredSelection, approved: ApprovedSelection['repositories'][number]): boolean {
  return String(selection.workspace.id) === approved.workspaceId && samePath(selection.root, approved.root)
}

function assertSafeReadOnlyPreset(registry: AgentPresetRegistry, presetId: string): void {
  const preset = registry.inspectCompositions().find(candidate => candidate.id === presetId)
  if (preset === undefined) throw new MultiRepositoryError(`read-only agent preset is not mounted: ${presetId}`, 'READ_ONLY_PRESET_UNAVAILABLE')
  const modules = preset.modules.map(module => module.moduleName)
  if (modules.some(module => !SAFE_PRESET_MODULES.has(module))
    || !modules.includes('@deepseek-ai/dsh-persona')) {
    throw new MultiRepositoryError(
      `agent preset ${JSON.stringify(presetId)} must contain only the read-only analysis persona`,
      'UNSAFE_READ_ONLY_PRESET',
    )
  }
}

async function inspectSource(ctx: Context, selection: RegisteredSelection, signal: AbortSignal): Promise<RepositorySource> {
  const root = selection.root
  const topLevel = (await runGit(ctx, root, ['rev-parse', '--show-toplevel'], signal)).stdout.trim()
  if (!samePath(await canonicalProcessPath(ctx.fs, topLevel, signal), root)) {
    throw new MultiRepositoryError('selected Workspace must be the Git repository root', 'GIT_ROOT_REQUIRED')
  }
  const commonDirectory = (await runGit(ctx, root, ['rev-parse', '--git-common-dir'], signal)).stdout.trim()
  const commonAbsolute = isAbsolute(commonDirectory) ? commonDirectory : resolve(root, commonDirectory)
  const commonGitDirectory = await canonicalProcessPath(ctx.fs, commonAbsolute, signal)
  const state = await captureSourceState(ctx, root, signal)
  return {
    ...selection,
    commonGitDirectory,
    state,
    rootInstructions: await readRootInstructions(ctx, root, signal),
  }
}

async function canonicalProcessPath(fs: FileSystem, path: string, signal: AbortSignal): Promise<string> {
  return fs.processPath(await fs.resolve(path, { signal }))
}

async function captureSourceState(ctx: Context, root: string, signal: AbortSignal): Promise<SourceState> {
  const headResult = await runGit(ctx, root, ['rev-parse', 'HEAD'], signal)
  const head = headResult.stdout.trim()
  const branchText = (await runGit(ctx, root, ['branch', '--show-current'], signal)).stdout.trim()
  const stagedRaw = await runGit(ctx, root, ['diff', '--raw', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv', '--cached', '-z', '--'], signal)
  const unstagedRaw = await runGit(ctx, root, ['diff', '--raw', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv', '-z', '--'], signal)
  const stagedPaths = splitGitPaths((await runGit(ctx, root,
    ['diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--cached', '-z', '--'], signal)).stdout)
  const unstagedPaths = splitGitPaths((await runGit(ctx, root,
    ['diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '-z', '--'], signal)).stdout)
  const untrackedAll = splitGitPaths((await runGit(ctx, root, ['ls-files', '--others', '--exclude-standard', '-z', '--'], signal)).stdout)
  if (untrackedAll.length > MAX_UNTRACKED_FILES) {
    throw new MultiRepositoryError(`repository has more than ${MAX_UNTRACKED_FILES} untracked files`, 'GIT_STATE_TOO_LARGE')
  }
  const ignored = splitGitPaths((await runGit(ctx, root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--'], signal)).stdout)
  const workingPaths = [...new Set([...unstagedPaths, ...untrackedAll])]
  const workingVersions = await Promise.all(workingPaths.map(async (path) => {
    const info = await ctx.fs.lstat(path, { cwd: root }, signal)
    return [path, info?.type ?? null, info?.version ?? null] as const
  }))
  const signature = createHash('sha256').update(JSON.stringify({
    head,
    branchText,
    staged: stagedRaw.stdout,
    unstaged: unstagedRaw.stdout,
    workingVersions,
    ignored,
  })).digest('hex')
  return {
    gitCommandEnforcement: headResult.enforcement,
    head,
    branch: branchText.length === 0 ? null : branchText,
    stagedPaths: displayPaths(stagedPaths),
    unstagedPaths: displayPaths(unstagedPaths),
    untrackedPaths: displayPaths(untrackedAll),
    stagedCount: stagedPaths.length,
    unstagedCount: unstagedPaths.length,
    untrackedCount: untrackedAll.length,
    ignoredPathCount: ignored.length,
    signature,
  }
}

function splitGitPaths(value: string): string[] {
  return value.split('\0').filter(path => path.length > 0)
}

function displayPaths(paths: readonly string[]): string[] {
  const safe = paths.filter(path => !isSensitivePath(path) && !isGitMetadataPath(path)).slice(0, MAX_STATUS_PATHS)
  const hidden = paths.length - safe.length
  return hidden === 0 ? safe : [...safe, `(${hidden} secret-like or additional paths omitted)`]
}

function isSensitivePath(path: string): boolean {
  const normalized = normalizeGitPath(path)
  return normalized.split('/').some((segment) => {
    const lowered = segment.toLowerCase()
    return lowered === '.env' || lowered.startsWith('.env.')
      || /\.(?:pem|key|p12|pfx)$/iu.test(lowered)
      || /^credentials(?:\.|$)/iu.test(lowered)
      || /^secrets?(?:\.|$)/iu.test(lowered)
      || /^id_(?:rsa|ed25519)/iu.test(lowered)
  })
}

function isGitMetadataPath(path: string): boolean {
  return normalizeGitPath(path).split('/')[0]?.toLowerCase() === '.git'
}

function positiveLineNumber(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MultiRepositoryError(`${name} must be a positive integer`, 'INVALID_READ_LIMIT')
  }
  return value
}

function normalizeGitPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '')
}

async function readRootInstructions(
  ctx: Context & { readonly fs: FileSystem; readonly sandbox: SandboxProvider; readonly subprocess: SubprocessRuntime },
  root: string,
  signal: AbortSignal,
): Promise<string> {
  const fs = ctx.fs
  const blocks: string[] = []
  const rootTarget = await fs.resolve(root, { signal })
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const path = resolve(root, name)
    const lexical = await fs.lstat(path, { cwd: root }, signal)
    if (lexical?.type !== 'file') continue
    if (await isIgnoredPath(ctx, root, name, signal)) continue
    const target = await fs.resolve(path, { cwd: root, signal })
    if (!fs.contains(rootTarget, target)) continue
    const info = await fs.stat(target, signal)
    if (info?.type !== 'file' || (info.size !== undefined && info.size > MAX_INSTRUCTION_BYTES)) continue
    const content = await fs.readText(target, signal)
    blocks.push(`### ${name}\n${content.slice(0, MAX_INSTRUCTION_BYTES)}`)
  }
  return blocks.join('\n\n')
}

async function sameRepository(fs: FileSystem, left: RepositorySource, right: RepositorySource): Promise<boolean> {
  const leftTarget = await fs.resolve(left.commonGitDirectory)
  const rightTarget = await fs.resolve(right.commonGitDirectory)
  return fs.contains(leftTarget, rightTarget) && fs.contains(rightTarget, leftTarget)
}

async function runRepositoryWorker(
  ctx: Context,
  config: Config,
  parent: NonNullable<ToolExecution['agent']>,
  source: RepositorySource,
  task: string,
  signal: AbortSignal,
  workerRoots: Map<string, string>,
  workerRunIds: Map<string, string>,
): Promise<RepositoryResult> {
  const observedAtStart = new Date().toISOString()
  const childId = SessionId(randomUUID())
  workerRoots.set(String(childId), source.root)
  let activation: SubagentActivation | undefined
  let execution: RepositoryResult['execution'] = 'startup-error'
  let stopReason = 'not-started'
  let assistantOutput = ''
  let runId: string | null = null
  let disposeOnAbort: (() => void) | undefined
  try {
    const started = await ctx.subagents.startActivation({
      provider: config.providerName,
      childId,
      cwd: source.root,
      agentPreset: config.readOnlyAgentPreset,
      readOnly: true,
      toolFilter: { allow: READ_ONLY_TOOLS },
      label: `repo-${source.workspace.title.slice(0, 20).toLowerCase().replace(/[^a-z0-9]+/gu, '-') || 'analysis'}`,
      prompt: [{ type: 'text', text: childPrompt(source, task) }],
      parent,
      signal,
      delivery: 'caller',
    })
    activation = started
    disposeOnAbort = (): void => {
      void started.dispose().catch((error: unknown) => {
        assistantOutput += `\nWorker cleanup failed: ${errorMessage(error)}`
      })
    }
    signal.addEventListener('abort', disposeOnAbort, { once: true })
    if (signal.aborted) disposeOnAbort()
    execution = 'result-error'
    const result = await started.result
    stopReason = result.stopReason
    assistantOutput = resultText(result)
    execution = result.stopReason === 'completed' ? 'result' : 'result-error'
  } catch (error: unknown) {
    signal.throwIfAborted()
    stopReason = errorCode(error)
    assistantOutput = errorMessage(error)
  } finally {
    if (disposeOnAbort !== undefined) signal.removeEventListener('abort', disposeOnAbort)
    if (activation !== undefined) {
      await activation.dispose().catch((error: unknown) => {
        if (!signal.aborted) assistantOutput += `\nWorker cleanup failed: ${errorMessage(error)}`
      })
    }
    runId = workerRunIds.get(String(childId)) ?? null
    workerRunIds.delete(String(childId))
    workerRoots.delete(String(childId))
  }

  const observedAtEnd = new Date().toISOString()
  let sourceChanged: boolean | null = null
  let observationError: string | null = null
  try {
    const finalState = await captureSourceState(ctx, source.root, signal)
    sourceChanged = finalState.signature !== source.state.signature
  } catch (error: unknown) {
    if (signal.aborted) throw error
    observationError = errorMessage(error)
  }
  return {
    execution,
    gitCommandEnforcement: source.state.gitCommandEnforcement,
    workspaceId: String(source.workspace.id),
    workspaceTitle: source.workspace.title,
    root: source.root,
    gitIdentity: source.commonGitDirectory,
    head: source.state.head,
    branch: source.state.branch,
    stagedPaths: source.state.stagedPaths,
    unstagedPaths: source.state.unstagedPaths,
    untrackedPaths: source.state.untrackedPaths,
    stagedCount: source.state.stagedCount,
    unstagedCount: source.state.unstagedCount,
    untrackedCount: source.state.untrackedCount,
    ignoredPathCount: source.state.ignoredPathCount,
    childSessionId: activation === undefined ? null : String(activation.childId),
    runId: activation === undefined ? null : runId,
    stopReason,
    assistantOutput,
    sourceChanged,
    observedAtStart,
    observedAtEnd,
    observationError,
  }
}

function childPrompt(source: RepositorySource, task: string): string {
  return [
    `Analyze only Workspace ${JSON.stringify(source.workspace.title)} at ${JSON.stringify(source.root)}.`,
    'This child Session is pinned to read-only policy and exposes only repository_list_files, repository_read_file, and read_staged_file. It has no generic filesystem tool, shell, process, mutation, child-delegation, or sandbox-mode-change tool.',
    `Committed HEAD: ${source.state.head}; branch: ${source.state.branch ?? '(detached)'}.`,
    `Staged paths (${source.state.stagedCount}; index version can be read with read_staged_file): ${JSON.stringify(source.state.stagedPaths)}.`,
    `Unstaged paths (${source.state.unstagedCount}): ${JSON.stringify(source.state.unstagedPaths)}.`,
    `Untracked, non-ignored paths (${source.state.untrackedCount}): ${JSON.stringify(source.state.untrackedPaths)}.`,
    `Ignored untracked files are excluded from automatic inspection (${source.state.ignoredPathCount} present). Secret-like filenames are excluded.`,
    'repository_read_file inspects the live working tree, not an immutable snapshot; read_staged_file inspects one staged index version. Cite paths and line numbers for each finding, and identify which state supplied the evidence.',
    source.rootInstructions.length === 0 ? 'No root AGENTS.md or CLAUDE.md instructions were found.' : `Repository root instructions:\n${source.rootInstructions}`,
    'Read nested repository instructions relevant to the source files before analyzing them. Never claim to have made changes.',
    `Task: ${task}`,
    'Return findings with concise reasoning and exact file:line evidence. Separate findings for this repository from any assumptions about the other repository.',
  ].join('\n\n')
}

function resultText(result: SubagentResult): string {
  return result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string {
  return error instanceof HarnessError ? error.code : errorMessage(error)
}

function enforceWorkerTool(execution: ToolExecution): PreToolDecision {
  if (execution.name !== 'repository_list_files' && execution.name !== 'repository_read_file' && execution.name !== STAGED_READ_TOOL) {
    return { kind: 'deny', reason: 'repository workers have read-only file tools; this operation is unavailable' }
  }
  return { kind: 'allow' }
}

function renderStagedContent(value: unknown): string {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.stage !== 'number' || typeof value.content !== 'string') {
    return 'Staged index content is unavailable.'
  }
  return `Staged index content for ${value.path} (stage ${value.stage}):\n${value.content}`
}

function renderFileList(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.paths) || typeof value.totalFiles !== 'number') {
    return 'Repository file list is unavailable.'
  }
  const paths = value.paths.filter((path): path is string => typeof path === 'string')
  const omitted = typeof value.omittedSensitiveFiles === 'number' ? value.omittedSensitiveFiles : 0
  return `Repository files (${value.totalFiles}; ${omitted} secret-like or Git metadata paths omitted):\n${paths.join('\n')}`
}

function renderWorkingTreeFile(value: unknown): string {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.offset !== 'number'
    || !Array.isArray(value.lines) || typeof value.totalLines !== 'number') {
    return 'Working-tree file content is unavailable.'
  }
  const lines = value.lines.flatMap((line) => {
    if (!isRecord(line) || typeof line.number !== 'number' || typeof line.text !== 'string') return []
    return [`${line.number}: ${line.text}`]
  })
  return `${value.path} (working tree; lines ${value.offset}–${value.offset + lines.length - 1} of ${value.totalLines}):\n${lines.join('\n')}`
}

function normalizeRepositoryRelativePath(root: string, requestedPath: string): string {
  if (requestedPath.trim().length === 0) throw new MultiRepositoryError('path must not be empty', 'INVALID_PATH')
  const absolute = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath)
  const path = relative(root, absolute)
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new MultiRepositoryError('staged file path must remain inside the selected Workspace', 'OUTSIDE_REPOSITORY')
  }
  return path.split(sep).join('/')
}

interface IndexEntry {
  readonly objectId: string
  readonly stage: number
  readonly path: string
}

function parseIndexEntries(output: string): IndexEntry[] {
  return output.split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t')
    if (separator < 0) throw new MultiRepositoryError('Git returned a malformed index entry', 'GIT_INDEX_INVALID')
    const [mode, objectId, stageText] = record.slice(0, separator).split(' ')
    const stage = Number(stageText)
    if (mode === undefined || objectId === undefined || !Number.isInteger(stage)) {
      throw new MultiRepositoryError('Git returned a malformed index entry', 'GIT_INDEX_INVALID')
    }
    return { objectId, stage, path: record.slice(separator + 1) }
  })
}

async function isIgnoredPath(
  ctx: Context & { readonly sandbox: SandboxProvider; readonly subprocess: SubprocessRuntime },
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await runGit(ctx, root,
    ['check-ignore', '--no-index', '-q', '--', path], signal, { acceptedExitCodes: [0, 1] })
  return result.exitCode === 0
}

async function runGit(
  ctx: Context & { sandbox: SandboxProvider; subprocess: SubprocessRuntime },
  root: string,
  args: readonly string[],
  signal: AbortSignal,
  options: { readonly acceptedExitCodes?: readonly number[]; readonly maxStdoutBytes?: number } = {},
): Promise<GitCommandResult> {
  assertReadOnlyGitCommand(args)
  const policy: SandboxPolicy = { mode: 'read-only', workspaceRoot: root }
  const confined = await ctx.sandbox.confine(['git', ...args], policy, signal)
  // Windows' restricted token cannot read ordinary user-owned repository files.
  // Keep Git internal: only fixed read verbs run on the host process, and no
  // arbitrary subprocess tool is exposed to the delegated worker.
  const argv = confined.enforcement === 'full' ? confined.argv : ['git', ...args]
  const windowsNull = gitNullDevice(process.platform)
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: root,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: options.maxStdoutBytes ?? MAX_GIT_OUTPUT_BYTES },
      stderr: { maxBytes: 16 * 1024 },
    },
    graceMs: 30_000,
    signal,
    env: {
      GIT_OPTIONAL_LOCKS: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: windowsNull,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'core.hooksPath',
      GIT_CONFIG_VALUE_1: windowsNull,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_COMMON_DIR: undefined,
      GIT_PREFIX: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: windowsNull,
    },
  })
  const outcome = await handle.done
  await handle.waitForExit(signal)
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout?.lossy === true || stderr?.lossy === true) {
    throw new MultiRepositoryError('Git output exceeded the bounded read limit', 'GIT_OUTPUT_TRUNCATED')
  }
  const accepted = options.acceptedExitCodes ?? [0]
  if (outcome.exitCode === null || !accepted.includes(outcome.exitCode)) {
    throw new MultiRepositoryError(
      `Git command failed in ${JSON.stringify(root)} (${outcome.exitCode ?? outcome.signal ?? 'unknown'}): ${stderr?.text.trim() || args.join(' ')}`,
      'GIT_COMMAND_FAILED',
    )
  }
  return { stdout: stdout?.text ?? '', stderr: stderr?.text ?? '', exitCode: outcome.exitCode, enforcement: confined.enforcement }
}

function repositoryWorkerRoot(
  agent: NonNullable<ToolExecution['agent']>,
  workerRoots: Map<string, string>,
): string | undefined {
  return workerRoots.get(String(agent.id))
}

function isRepositoryWorker(
  agent: NonNullable<ToolExecution['agent']>,
  workerRoots: Map<string, string>,
): boolean {
  return repositoryWorkerRoot(agent, workerRoots) !== undefined
}

function renderRepositoryResults(value: unknown): string {
  const rows = repositoryRows(value)
  return rows.map(row => [
    `${row.workspaceTitle} (${row.root}; Workspace ${row.workspaceId}) — ${row.execution}`,
    `Git command enforcement: ${row.gitCommandEnforcement}; partial enforcement uses fixed read-only Git commands without exposing subprocess access to the worker.`,
    `Git ${row.gitIdentity}; branch ${row.branch ?? '(detached)'}; committed HEAD ${row.head}.`,
    `Staged paths (${row.stagedCount}): ${JSON.stringify(row.stagedPaths)}; unstaged paths (${row.unstagedCount}): ${JSON.stringify(row.unstagedPaths)}; untracked non-ignored paths (${row.untrackedCount}): ${JSON.stringify(row.untrackedPaths)}; ignored untracked files excluded: ${row.ignoredPathCount}.`,
    `Child Session ${row.childSessionId ?? 'not started'}; run ${row.runId ?? 'not started'}; stop ${row.stopReason}.`,
    `Source changed during analysis: ${row.sourceChanged === null ? 'unknown' : String(row.sourceChanged)}; observation ${row.observedAtStart} to ${row.observedAtEnd ?? 'unfinished'}.`,
    row.sourceChanged === true || row.observationError !== null
      ? 'Source state changed or could not be rechecked; treat findings as potentially stale and verify them again.'
      : '',
    row.observationError === null ? '' : `Final source observation error: ${row.observationError}.`,
    'Findings and source evidence:', row.assistantOutput || '(no child text output)',
  ].filter(Boolean).join('\n')).join('\n\n')
}

function repositoryRows(value: unknown): RepositoryResult[] {
  if (!isRecord(value) || !Array.isArray(value.repositories)) return []
  return value.repositories.filter(isRepositoryResult)
}

function isRepositoryResult(value: unknown): value is RepositoryResult {
  return isRecord(value)
    && typeof value.execution === 'string'
    && (value.gitCommandEnforcement === 'full' || value.gitCommandEnforcement === 'partial')
    && typeof value.workspaceId === 'string'
    && typeof value.workspaceTitle === 'string'
    && typeof value.root === 'string'
    && typeof value.gitIdentity === 'string'
    && typeof value.head === 'string'
    && Array.isArray(value.stagedPaths)
    && Array.isArray(value.unstagedPaths)
    && Array.isArray(value.untrackedPaths)
    && typeof value.stagedCount === 'number'
    && typeof value.unstagedCount === 'number'
    && typeof value.untrackedCount === 'number'
    && typeof value.assistantOutput === 'string'
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight
}
