/**
 * Model-facing coordination of one coding task across two explicitly selected
 * local Git Workspaces, using independent DSH child Sessions and clones.
 * @module @deepseek-ai/dsh-tool-multi-repository
 */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ConfinedSandboxMode, SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubagentActivation, SubagentResult, SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { PreToolDecision, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by Loader composition. */
export const name = 'tool-multi-repository'
/** Services needed to validate, clone, delegate, and report selected repositories. */
export const inject = ['tools', 'agents', 'workspaceRegistry', 'subagents', 'sandbox', 'sandboxPolicy', 'subprocess', 'shell', 'fs']

/** Provider name used by the repository-scoped child activations. */
export interface Config {
  /** In-process DSH provider that advertises `permissionRoot` (default `spawn`). */
  providerName?: string
}

export const Config = z.object({ providerName: z.string().default('spawn') })

const TOOL_NAME = 'coordinate_repositories'

interface GitCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly enforcement: SandboxEnforcement
}

interface RepositorySource {
  readonly workspace: Workspace
  readonly root: string
  readonly commonGitDirectory: string
  readonly head: string
  readonly branch: string | null
}

interface PreparedRepository extends RepositorySource {
  readonly runDirectory: string
  readonly cloneRoot: string
  readonly childBranch: string
  readonly setupEnforcement: SandboxEnforcement
}

interface RepositoryOutcome {
  readonly execution: 'result' | 'startup-error' | 'result-error'
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly sourceRoot: string
  readonly sourceGitIdentity: string
  readonly sourceHead: string
  readonly sourceBranch: string | null
  readonly cloneRoot: string
  readonly childBranch: string
  readonly childSessionId?: string
  readonly runId?: string
  readonly stopReason: string
  readonly assistantOutput: string
  readonly finalHead: string | null
  readonly gitStatus: string | null
  readonly diffStat: string | null
  readonly setupEnforcement: SandboxEnforcement
  readonly evidenceError?: string
}

interface ApprovedRepository {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly root: string
  readonly commonGitDirectory: string
  readonly head: string
}

interface ApprovedSelection {
  readonly repositories: readonly [ApprovedRepository, ApprovedRepository]
  readonly task: string
}

interface ToolArgs {
  readonly repositories: readonly [string, string]
  readonly task: string
}

/** Structured failure returned by multi-repository operations. */
class MultiRepositoryError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'MultiRepositoryError'
  }
}

const outputSchema: JsonSchemaNode = {
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
          'execution', 'workspaceId', 'workspaceTitle', 'sourceRoot', 'sourceGitIdentity', 'sourceHead', 'sourceBranch', 'cloneRoot', 'childBranch',
          'stopReason', 'assistantOutput', 'finalHead', 'gitStatus', 'diffStat', 'setupEnforcement',
        ],
        properties: {
          execution: { type: 'string', enum: ['result', 'startup-error', 'result-error'] },
          workspaceId: { type: 'string' },
          workspaceTitle: { type: 'string' },
          sourceRoot: { type: 'string' },
          sourceGitIdentity: { type: 'string' },
          sourceHead: { type: 'string' },
          sourceBranch: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          cloneRoot: { type: 'string' },
          childBranch: { type: 'string' },
          childSessionId: { type: 'string' },
          runId: { type: 'string' },
          stopReason: { type: 'string' },
          assistantOutput: { type: 'string' },
          finalHead: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          gitStatus: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          diffStat: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          setupEnforcement: { type: 'string', enum: ['full', 'partial'] },
          evidenceError: { type: 'string' },
        },
      },
    },
  },
}

function createTool(
  ctx: Context,
  configuredProviderName: string,
  approvedSelections: Map<ToolCallId, ApprovedSelection>,
): ToolDefinition {
  const tool: ToolDefinition = {
    name: TOOL_NAME,
    description: [
      'Coordinate one coding task across exactly two explicitly selected local Git Workspaces. Supply the two absolute Workspace roots.',
      'DSH starts one fresh child Session per repository in separate clean clones, waits for both results, and returns each repository,',
      'child Session, run ID, and Git evidence. The roots must be registered Workspaces, Git repository roots, and clean at the selected',
      'commit. Before cloning, DSH requests one approval that names both roots and the shared task. Child writes require a sandbox backend that reports full enforcement;',
      'DSH does not restrict filesystem reads outside a Session root.',
    ].join(' '),
    parameters: {
      repositories: {
        type: 'array',
        required: true,
        minItems: 2,
        maxItems: 2,
        items: { type: 'string', description: 'Absolute root path of one user-selected Workspace.' },
        description: 'Exactly two absolute Workspace root paths, in the order whose results should be returned.',
      },
      task: {
        type: 'string',
        required: true,
        description: 'One self-contained coding task to perform independently in each selected repository.',
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => {
        const repos = isJsonRecord(value) && isJsonArray(value.repositories) ? value.repositories : []
        const rows = repos.flatMap((entry) => {
          if (!isJsonRecord(entry)) return []
          const title = stringField(entry, 'workspaceTitle')
          const sourceRoot = stringField(entry, 'sourceRoot')
          const execution = stringField(entry, 'execution')
          const stopReason = stringField(entry, 'stopReason')
          const sourceHead = stringField(entry, 'sourceHead')
          const sourceGitIdentity = stringField(entry, 'sourceGitIdentity')
          const cloneRoot = stringField(entry, 'cloneRoot')
          const childBranch = stringField(entry, 'childBranch')
          const setupEnforcement = stringField(entry, 'setupEnforcement')
          if ([title, sourceRoot, execution, stopReason, sourceHead, sourceGitIdentity, cloneRoot, childBranch, setupEnforcement]
            .some(item => item === undefined)) return []
          const sourceBranch = nullableStringField(entry, 'sourceBranch') ?? 'unavailable'
          const finalHead = nullableStringField(entry, 'finalHead') ?? 'unavailable'
          const gitStatus = nullableStringField(entry, 'gitStatus') ?? 'unavailable'
          const trackedDiff = stringField(entry, 'diffStat')
          const assistantOutput = stringField(entry, 'assistantOutput') ?? ''
          return [
            [
              `${title} (${sourceRoot}; Git ${sourceGitIdentity}; source branch ${sourceBranch}) — ${execution};`,
              ` Session ${stringField(entry, 'childSessionId') ?? 'not started'}, run ${stringField(entry, 'runId') ?? 'not started'}, ${stopReason};`,
              ` base ${sourceHead}; final ${finalHead}; worktree status ${JSON.stringify(gitStatus)};`,
              ` tracked diff ${trackedDiff === undefined || trackedDiff.length === 0 ? 'none' : trackedDiff};`,
              ` clone ${cloneRoot} (${childBranch}); sandbox ${setupEnforcement}; child report ${assistantOutput}`,
            ].join(''),
          ]
        })
        return [{ type: 'text', text: rows.join('\n') }]
      },
      presentationMeta: (_args, value) => {
        const repos = isJsonRecord(value) && isJsonArray(value.repositories) ? value.repositories : []
        return { repositories: repos.flatMap((entry) => {
          if (!isJsonRecord(entry)) return []
          const workspaceId = stringField(entry, 'workspaceId')
          const sourceRoot = stringField(entry, 'sourceRoot')
          const cloneRoot = stringField(entry, 'cloneRoot')
          const childBranch = stringField(entry, 'childBranch')
          const execution = stringField(entry, 'execution')
          const stopReason = stringField(entry, 'stopReason')
          if (workspaceId === undefined || sourceRoot === undefined || cloneRoot === undefined
          || childBranch === undefined || execution === undefined || stopReason === undefined) return []
          const childSessionId = stringField(entry, 'childSessionId')
          const runId = stringField(entry, 'runId')
          return [{
            workspaceId, sourceRoot, cloneRoot, childBranch, execution, stopReason,
            ...(childSessionId === undefined ? {} : { childSessionId }),
            ...(runId === undefined ? {} : { runId }),
          }]
        }) }
      },
    },
    async execute(rawArgs, exec) {
      const args = rawArgs as ToolArgs
      const parent = exec.agent
      if (parent === undefined) throw new MultiRepositoryError('repository coordination requires a live parent Agent', 'PARENT_UNAVAILABLE')
      if (ctx.agents.get(parent.id) !== parent || parent.ctx.fiber.state !== FiberState.ACTIVE) {
        throw new MultiRepositoryError('repository coordination requires an active Agent in the registering context', 'PARENT_UNAVAILABLE')
      }
      if (parent.session.header.parentSession !== undefined) {
        throw new MultiRepositoryError('repository coordination is available only to a conversation started by the user', 'DELEGATED_COORDINATION_DENIED')
      }
      const authorization = approvedSelections.get(exec.callId)
      approvedSelections.delete(exec.callId)
      if (authorization === undefined || authorization.task !== args.task) {
        throw new MultiRepositoryError('repository coordination requires one-shot approval for this exact task and repository selection', 'WRITE_AUTHORIZATION_REQUIRED')
      }
      assertExecutionServices(ctx)
      const provider = ctx.subagents.getProvider(configuredProviderName)
      if (provider === undefined || !provider.capabilities.permissionRoot
        || provider.prepareContinuable === undefined || provider.inheritsParentContext) {
        throw new MultiRepositoryError(
          `provider ${JSON.stringify(configuredProviderName)} does not support scoped in-process DSH children`,
          'SCOPED_PROVIDER_UNAVAILABLE',
        )
      }

      const workspaces = ctx.workspaceRegistry.list()
      const [firstPath, secondPath] = args.repositories
      const [firstSource, secondSource] = await Promise.all([
        inspectSource(ctx.fs, ctx.subprocess, ctx.sandbox, workspaces, firstPath, exec.signal),
        inspectSource(ctx.fs, ctx.subprocess, ctx.sandbox, workspaces, secondPath, exec.signal),
      ])
      assertApprovedSource(firstSource, authorization.repositories[0])
      assertApprovedSource(secondSource, authorization.repositories[1])
      const sources = [firstSource, secondSource]
      if (await sameRepository(firstSource, secondSource, ctx.fs)) {
        throw new MultiRepositoryError('the two selected Workspaces resolve to the same Git repository identity', 'DUPLICATE_REPOSITORY')
      }

      const home = await realpath(resolveDshHome())
      await assertRunHomeOutsideGitRepository(home)
      if (ctx.sandboxPolicy.additionalWritableRoots !== undefined && ctx.sandboxPolicy.additionalWritableRoots.length > 0) {
        throw new MultiRepositoryError('repository-scoped work is unavailable while global additional writable roots are configured', 'UNSCOPED_WRITABLE_ROOTS')
      }
      const tempRoot = await realpath(tmpdir())
      const selectedRoots = new Set(sources.map(source => source.root))
      const temporaryWorkspace = workspaces.find(workspace => isPathUnder(tempRoot, workspace.path) && !selectedRoots.has(workspace.path))
      if (temporaryWorkspace !== undefined) {
        throw new MultiRepositoryError(
          `registered Workspace ${JSON.stringify(temporaryWorkspace.path)} is inside an operating-system temporary directory, which DSH workspace-write also permits`,
          'UNSELECTED_WORKSPACE_INSIDE_TEMP',
        )
      }
      for (const source of sources) {
        if (pathsOverlap(home, source.root)) {
          throw new MultiRepositoryError('DSH_HOME and each selected repository must be separate directories', 'RUN_HOME_INSIDE_REPOSITORY')
        }
        if (isPathUnder(tempRoot, source.root)) {
          throw new MultiRepositoryError('selected repositories inside the operating-system temporary directory cannot receive independent DSH write scopes', 'REPOSITORY_INSIDE_TEMP')
        }
      }
      if (isPathUnder(tempRoot, home)) {
        throw new MultiRepositoryError('DSH_HOME cannot be inside the operating-system temporary directory', 'RUN_HOME_INSIDE_TEMP')
      }
      if (workspaces.some(workspace => isPathUnder(workspace.path, home))) {
        throw new MultiRepositoryError('DSH_HOME cannot be inside a registered Workspace', 'RUN_HOME_INSIDE_WORKSPACE')
      }

      const prepared: PreparedRepository[] = []
      const runDirectories: string[] = []
      try {
        for (const source of sources) {
          const runDirectory = await createRunDirectory(home, workspaces, sources)
          runDirectories.push(runDirectory)
          const cloneRoot = join(runDirectory, 'repository')
          await mkdir(cloneRoot)
          const cloned = await runGit(ctx.subprocess, ctx.sandbox, {
            argv: ['git', 'clone', '--quiet', '--no-hardlinks', '--dissociate', '--no-checkout', '--', source.root, cloneRoot],
            cwd: source.root,
            workspaceRoot: cloneRoot,
            mode: 'workspace-write',
            signal: exec.signal,
          })
          const childBranch = `dsh-run-${randomUUID()}`
          await runGit(ctx.subprocess, ctx.sandbox, {
            argv: ['git', 'remote', 'remove', 'origin'], cwd: cloneRoot, workspaceRoot: cloneRoot, mode: 'workspace-write', signal: exec.signal,
          })
          await runGit(ctx.subprocess, ctx.sandbox, {
            argv: ['git', 'checkout', '--quiet', '-b', childBranch, source.head],
            cwd: cloneRoot,
            workspaceRoot: cloneRoot,
            mode: 'workspace-write',
            signal: exec.signal,
          })
          prepared.push({ ...source, runDirectory, cloneRoot, childBranch, setupEnforcement: cloned.enforcement })
        }
      } catch (error: unknown) {
        const cleanup = await Promise.allSettled(runDirectories.map(directory => rm(directory, { recursive: true, force: true })))
        const cleanupFailure = cleanup.find(result => result.status === 'rejected')
        if (cleanupFailure === undefined && error instanceof MultiRepositoryError && error.code === 'SANDBOX_ENFORCEMENT_INCOMPLETE') {
          throw error
        }
        const detail = error instanceof Error ? error.message : 'unknown clone setup failure'
        throw new MultiRepositoryError(
          cleanupFailure === undefined
            ? `cannot prepare isolated repository clones: ${detail}`
            : `cannot prepare isolated repository clones: ${detail}; clone cleanup also failed`,
          'CLONE_SETUP_FAILED',
          { cause: error },
        )
      }

      const started = await Promise.all(prepared.map(async (repo) => {
        try {
          const activation = await ctx.subagents.startActivation({
            provider: configuredProviderName,
            label: `Repository ${repo.workspace.title}`,
            name: `repo-${randomUUID().replaceAll('-', '').slice(0, 27)}`,
            parent,
            cwd: repo.cloneRoot,
            permissionRoot: repo.cloneRoot,
            prompt: [{ type: 'text', text: childPrompt(args.task, repo) }],
            signal: exec.signal,
            delivery: 'caller',
          })
          return { repo, activation } as const
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : 'unknown child start failure'
          return { repo, error: detail } as const
        }
      }))

      const activations = started.flatMap(entry => 'activation' in entry ? [entry.activation] : [])
      let abortCleanup: Promise<void> | undefined
      const stopPublishedChildren = (): Promise<void> => {
        if (abortCleanup === undefined) {
          abortCleanup = disposeActivations(activations)
          void abortCleanup.catch(() => undefined)
        }
        return abortCleanup
      }
      const abortPublishedChildren = (): void => { void stopPublishedChildren() }
      exec.signal.addEventListener('abort', abortPublishedChildren, { once: true })
      try {
        if (exec.signal.aborted) await stopPublishedChildren()
        const repositories = await Promise.all(started.map(async (entry) => {
          if (!('activation' in entry)) return failedOutcome(entry.repo, entry.error)
          try {
            const result = await entry.activation.result
            return await completedOutcome(
              ctx.subprocess,
              ctx.sandbox,
              entry.repo,
              entry.activation.childId,
              entry.activation.runId,
              result,
              exec.signal,
            )
          } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : 'unknown child result failure'
            return failedActivationOutcome(entry.repo, entry.activation.childId, entry.activation.runId, detail)
          }
        }))
        if (abortCleanup !== undefined) await abortCleanup
        exec.signal.throwIfAborted()
        return { repositories }
      } finally {
        exec.signal.removeEventListener('abort', abortPublishedChildren)
        if (abortCleanup !== undefined) await abortCleanup
      }
    },
  }
  return tool
}

/**
 * Register the model-facing repository coordination tool.
 * @param ctx - Cordis context providing Workspace, sandbox, shell, filesystem, and subagent services.
 * @param config - in-process provider name used for both repository children.
 */
export function apply(ctx: Context, config: Config): void {
  const approvedSelections = new Map<ToolCallId, ApprovedSelection>()
  const tool = createTool(ctx, config.providerName ?? 'spawn', approvedSelections)
  ctx.effect(() => {
    return ctx.tools.register(tool)
  })
  ctx.effect(() => {
    const stopBeforeExecute = ctx.on('tools/pre-execute', (execution, next) => {
      if (execution.name !== TOOL_NAME) return next()
      if (execution.agent === undefined) {
        return Promise.resolve({ kind: 'deny', reason: 'repository coordination requires a live user conversation' })
      }
      if (execution.agent.session.header.parentSession !== undefined) return next()
      return repositoryApprovalDecision(ctx, execution, approvedSelections)
    })
    const stopAfterResult = ctx.on('tools/result', (execution) => {
      if (execution.name === TOOL_NAME) approvedSelections.delete(execution.callId)
    })
    return () => {
      approvedSelections.clear()
      stopBeforeExecute()
      stopAfterResult()
    }
  })
}

/** Identify the exact repositories before asking for one-call write authorization. */
async function repositoryApprovalDecision(
  ctx: Context,
  execution: ToolExecution,
  approvedSelections: Map<ToolCallId, ApprovedSelection>,
): Promise<PreToolDecision> {
  const args = readToolArgs(execution.arguments)
  if (args === undefined) {
    return { kind: 'deny', reason: 'repository coordination requires exactly two Workspace roots and one task' }
  }
  assertExecutionServices(ctx)
  const workspaces = ctx.workspaceRegistry.list()
  const [firstSource, secondSource] = await Promise.all([
    inspectSource(ctx.fs, ctx.subprocess, ctx.sandbox, workspaces, args.repositories[0], execution.signal),
    inspectSource(ctx.fs, ctx.subprocess, ctx.sandbox, workspaces, args.repositories[1], execution.signal),
  ])
  if (await sameRepository(firstSource, secondSource, ctx.fs)) {
    return { kind: 'deny', reason: 'the two selected Workspaces resolve to the same Git repository identity' }
  }
  const first = approvedRepository(firstSource)
  const second = approvedRepository(secondSource)
  const approvedRepositories: readonly [ApprovedRepository, ApprovedRepository] = [first, second]
  const approved: ApprovedSelection = { repositories: approvedRepositories, task: args.task }
  approvedSelections.set(execution.callId, approved)
  const reason = `Write-capable repository coordination: ${JSON.stringify([
    {
      workspaceId: first.workspaceId,
      workspaceTitle: first.workspaceTitle,
      root: first.root,
      gitDirectory: first.commonGitDirectory,
      head: first.head,
    },
    {
      workspaceId: second.workspaceId,
      workspaceTitle: second.workspaceTitle,
      root: second.root,
      gitDirectory: second.commonGitDirectory,
      head: second.head,
    },
  ])}; task ${JSON.stringify(args.task)}`
  return {
    kind: 'ask',
    reason,
    displayReason: {
      en: [
        'Allow one write-capable coding run in isolated clones of these repositories?',
        `Repository 1: ${first.workspaceTitle} (${first.workspaceId}; ${first.root}) at ${first.head}`,
        `Repository 2: ${second.workspaceTitle} (${second.workspaceId}; ${second.root}) at ${second.head}`,
        `Shared task: ${args.task}`,
      ].join('\n'),
      zh: [
        '是否允许在以下仓库的独立克隆中执行一次可写编码任务？',
        `仓库 1：${first.workspaceTitle}（${first.workspaceId}；${first.root}），提交 ${first.head}`,
        `仓库 2：${second.workspaceTitle}（${second.workspaceId}；${second.root}），提交 ${second.head}`,
        `共同任务：${args.task}`,
      ].join('\n'),
    },
  }
}

/** Ensure the repository did not change while one-shot authorization was pending. */
function assertApprovedSource(source: RepositorySource, approved: ApprovedRepository): void {
  if (String(source.workspace.id) !== approved.workspaceId || source.root !== approved.root
    || source.commonGitDirectory !== approved.commonGitDirectory || source.head !== approved.head) {
    throw new MultiRepositoryError('a selected repository changed after write authorization; ask again before retrying', 'APPROVED_REPOSITORY_CHANGED')
  }
}

/** Capture only the repository identity needed to bind one approval to this checkout. */
function approvedRepository(source: RepositorySource): ApprovedRepository {
  return {
    workspaceId: String(source.workspace.id),
    workspaceTitle: source.workspace.title,
    root: source.root,
    commonGitDirectory: source.commonGitDirectory,
    head: source.head,
  }
}

/** Read the model-authored call arguments used to describe the approval request. */
function readToolArgs(value: unknown): ToolArgs | undefined {
  if (!isUnknownRecord(value)) return undefined
  const repositories = value.repositories
  if (!Array.isArray(repositories) || repositories.length !== 2) return undefined
  const first: unknown = repositories[0]
  const second: unknown = repositories[1]
  const task = value.task
  if (typeof first !== 'string' || typeof second !== 'string' || typeof task !== 'string') return undefined
  return { repositories: [first, second], task }
}

/** Narrow one parsed model argument object without trusting its index fields. */
function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExecutionServices(ctx: Context): asserts ctx is Context & {
  readonly fs: FileSystem
  readonly shell: ShellExecutor
  readonly sandbox: SandboxProvider
  readonly sandboxPolicy: SandboxPolicyService
  readonly subprocess: SubprocessRuntime
  readonly subagents: SubagentRuntime
  readonly workspaceRegistry: WorkspaceRegistry
} {
  if (ctx.fs.sandboxMode === undefined || ctx.shell.sandboxMode === undefined) {
    throw new MultiRepositoryError('repository workers require sandboxed filesystem and shell providers', 'SANDBOX_UNAVAILABLE')
  }
}

async function inspectSource(
  fs: FileSystem,
  subprocess: SubprocessRuntime,
  sandbox: SandboxProvider,
  workspaces: readonly Workspace[],
  requestedPath: string,
  signal: AbortSignal,
): Promise<RepositorySource> {
  if (!isAbsolute(requestedPath)) throw new MultiRepositoryError('selected Workspace paths must be absolute', 'WORKSPACE_NOT_SELECTED')
  const requestedTarget = await fs.resolve(requestedPath, { signal })
  const root = fs.processPath(requestedTarget)
  const workspace = workspaces.find(candidate => samePath(candidate.path, root))
  if (workspace === undefined) throw new MultiRepositoryError(`path is not a registered Workspace: ${JSON.stringify(requestedPath)}`, 'WORKSPACE_NOT_SELECTED')
  const hostMapping = fs.processPathFromHostPath(workspace.path)
  if (hostMapping === undefined || !samePath(hostMapping, root)) {
    throw new MultiRepositoryError('repository coordination requires a local filesystem shared with the subprocess provider', 'LOCAL_FILESYSTEM_REQUIRED')
  }
  const rootInfo = await fs.stat(requestedTarget, signal)
  if (rootInfo?.type !== 'directory') throw new MultiRepositoryError(`selected Workspace is not an existing directory: ${JSON.stringify(requestedPath)}`, 'WORKSPACE_NOT_SELECTED')

  const topLevel = (await runGit(subprocess, sandbox, {
    argv: ['git', 'rev-parse', '--show-toplevel'], cwd: root, workspaceRoot: root, mode: 'read-only', signal,
  })).stdout.trim()
  const canonicalTopLevel = fs.processPath(await fs.resolve(topLevel, { signal }))
  if (canonicalTopLevel !== root) {
    throw new MultiRepositoryError(`selected Workspace must be a Git repository root: ${JSON.stringify(requestedPath)}`, 'GIT_ROOT_REQUIRED')
  }
  const commonPath = (await runGit(subprocess, sandbox, {
    argv: ['git', 'rev-parse', '--git-common-dir'], cwd: root, workspaceRoot: root, mode: 'read-only', signal,
  })).stdout.trim()
  const commonAbsolute = isAbsolute(commonPath) ? commonPath : resolve(root, commonPath)
  const commonGitDirectory = fs.processPath(await fs.resolve(commonAbsolute, { signal }))
  const head = (await runGit(subprocess, sandbox, {
    argv: ['git', 'rev-parse', 'HEAD'], cwd: root, workspaceRoot: root, mode: 'read-only', signal,
  })).stdout.trim()
  const branchText = (await runGit(subprocess, sandbox, {
    argv: ['git', 'branch', '--show-current'], cwd: root, workspaceRoot: root, mode: 'read-only', signal,
  })).stdout.trim()
  const status = (await runGit(subprocess, sandbox, {
    argv: ['git', 'status', '--porcelain=v1', '--untracked-files=all'], cwd: root, workspaceRoot: root, mode: 'read-only', signal,
    env: { GIT_OPTIONAL_LOCKS: '0' },
  })).stdout
  if (status.trim().length > 0) {
    throw new MultiRepositoryError(`selected repository must be clean at its captured Git state: ${JSON.stringify(workspace.path)}`, 'GIT_WORKTREE_DIRTY')
  }
  return {
    workspace,
    root,
    commonGitDirectory,
    head,
    branch: branchText.length === 0 ? null : branchText,
  }
}

async function sameRepository(left: RepositorySource, right: RepositorySource, fs: FileSystem): Promise<boolean> {
  const leftTarget = await fs.resolve(left.commonGitDirectory)
  const rightTarget = await fs.resolve(right.commonGitDirectory)
  return fs.contains(leftTarget, rightTarget) && fs.contains(rightTarget, leftTarget)
}

async function createRunDirectory(
  home: string,
  workspaces: readonly Workspace[],
  sources: readonly RepositorySource[],
): Promise<string> {
  const runDirectory = await mkdtemp(join(home, 'repository-run-'))
  const canonicalDirectory = await realpath(runDirectory)
  if (isPathUnder(await realpath(tmpdir()), canonicalDirectory)) {
    await rm(canonicalDirectory, { recursive: true, force: true })
    throw new MultiRepositoryError('repository run storage cannot be inside the operating-system temporary directory', 'RUN_HOME_INSIDE_TEMP')
  }
  if (sources.some(source => pathsOverlap(source.root, canonicalDirectory))) {
    await rm(canonicalDirectory, { recursive: true, force: true })
    throw new MultiRepositoryError('repository run storage must be outside selected repositories', 'RUN_HOME_INSIDE_REPOSITORY')
  }
  if (workspaces.some(workspace => pathsOverlap(workspace.path, canonicalDirectory))) {
    await rm(canonicalDirectory, { recursive: true, force: true })
    throw new MultiRepositoryError('repository run storage must be outside registered Workspaces', 'RUN_HOME_INSIDE_WORKSPACE')
  }
  return canonicalDirectory
}

async function assertRunHomeOutsideGitRepository(home: string): Promise<void> {
  let candidate = home
  while (true) {
    const gitEntry = await lstatIfPresent(join(candidate, '.git'))
    const [head, objects, config] = await Promise.all([
      lstatIfPresent(join(candidate, 'HEAD')),
      lstatIfPresent(join(candidate, 'objects')),
      lstatIfPresent(join(candidate, 'config')),
    ])
    const bareRepository = head?.isFile() === true && objects?.isDirectory() === true && config?.isFile() === true
    if (gitEntry || bareRepository) {
      throw new MultiRepositoryError('DSH_HOME cannot be inside a Git repository', 'RUN_HOME_INSIDE_GIT_REPOSITORY')
    }
    const parent = dirname(candidate)
    if (parent === candidate) return
    candidate = parent
  }
}

async function lstatIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
    throw error
  }
}

async function runGit(
  subprocess: SubprocessRuntime,
  sandbox: SandboxProvider,
  request: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly workspaceRoot: string
    readonly mode: ConfinedSandboxMode
    readonly signal: AbortSignal
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<GitCommandResult> {
  const policy: SandboxPolicy = { mode: request.mode, workspaceRoot: request.workspaceRoot }
  const confined = await sandbox.confine(request.argv, policy, request.signal)
  if (request.mode === 'workspace-write' && confined.enforcement !== 'full') {
    throw new MultiRepositoryError(
      `repository-scoped writes require full sandbox enforcement; the selected backend reports ${confined.enforcement}`,
      'SANDBOX_ENFORCEMENT_INCOMPLETE',
    )
  }
  const handle = subprocess.spawn({
    argv: confined.argv,
    cwd: request.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 65_536 },
      stderr: { maxBytes: 16_384 },
    },
    graceMs: 30_000,
    signal: request.signal,
    env: {
      ...request.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: globalThis.process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_PARAMETERS: undefined,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'core.hooksPath',
      GIT_CONFIG_VALUE_1: globalThis.process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_COMMON_DIR: undefined,
      GIT_PREFIX: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  const outcome = await handle.done
  await handle.waitForExit(request.signal)
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout?.lossy === true || stderr?.lossy === true) {
    throw new MultiRepositoryError('Git produced more output than the bounded evidence reader can retain', 'GIT_OUTPUT_TRUNCATED')
  }
  const text = stdout?.text ?? ''
  const errorText = stderr?.text ?? ''
  if (outcome.exitCode !== 0) {
    throw new MultiRepositoryError(
      `Git command failed (${outcome.exitCode ?? outcome.signal ?? 'unknown'}): ${errorText.trim() || request.argv.slice(1).join(' ')}`,
      'GIT_COMMAND_FAILED',
    )
  }
  return { stdout: text, stderr: errorText, enforcement: confined.enforcement }
}

function childPrompt(task: string, repo: PreparedRepository): string {
  return [
    `You are assigned to Workspace ${JSON.stringify(repo.workspace.title)} at ${JSON.stringify(repo.cloneRoot)}.`,
    'This fresh DSH Session has a DSH write root at this isolated clone. Work only from this clone and do not read or modify other repositories. DSH does not confine reads outside a Session root, so this instruction is not a read-access sandbox.',
    `The clone starts clean at commit ${repo.head} on source branch ${repo.branch ?? '(detached)'}. Its working branch is ${repo.childBranch}.`,
    'Read this repository’s own AGENTS.md or CLAUDE.md instructions before changing files.',
    `Task: ${task}`,
    'Return a concise summary naming changed paths and checks run. Do not claim changes that are absent from this clone’s Git state.',
  ].join('\n\n')
}

async function disposeActivations(activations: readonly SubagentActivation[]): Promise<void> {
  const settled = await Promise.allSettled(activations.map(activation => activation.dispose()))
  const failures = settled.flatMap(result => result.status === 'rejected'
    ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
    : [])
  if (failures.length > 0) {
    throw new MultiRepositoryError(`cannot stop every repository child after parent cancellation: ${failures.join('; ')}`, 'CHILD_CLEANUP_FAILED')
  }
}

async function completedOutcome(
  subprocess: SubprocessRuntime,
  sandbox: SandboxProvider,
  repo: PreparedRepository,
  childSessionId: string,
  runId: SubagentRunId,
  result: SubagentResult,
  signal: AbortSignal,
): Promise<RepositoryOutcome> {
  try {
    const finalHead = (await runGit(subprocess, sandbox, {
      argv: ['git', 'rev-parse', 'HEAD'], cwd: repo.cloneRoot, workspaceRoot: repo.cloneRoot, mode: 'read-only', signal,
    })).stdout.trim()
    const gitStatus = (await runGit(subprocess, sandbox, {
      argv: ['git', 'status', '--short', '--branch', '--untracked-files=all'], cwd: repo.cloneRoot, workspaceRoot: repo.cloneRoot, mode: 'read-only', signal,
    })).stdout.trim()
    const diffStat = (await runGit(subprocess, sandbox, {
      argv: ['git', 'diff', '--stat', '--no-ext-diff', repo.head], cwd: repo.cloneRoot, workspaceRoot: repo.cloneRoot, mode: 'read-only', signal,
    })).stdout.trim()
    return baseOutcome(repo, childSessionId, runId, result, finalHead, gitStatus, diffStat)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown Git evidence failure'
    return baseOutcome(repo, childSessionId, runId, result, null, null, null, detail)
  }
}

function failedOutcome(repo: PreparedRepository, error: string): RepositoryOutcome {
  return {
    execution: 'startup-error',
    workspaceId: String(repo.workspace.id),
    workspaceTitle: repo.workspace.title,
    sourceRoot: repo.root,
    sourceGitIdentity: repo.commonGitDirectory,
    sourceHead: repo.head,
    sourceBranch: repo.branch,
    cloneRoot: repo.cloneRoot,
    childBranch: repo.childBranch,
    stopReason: 'startup-error',
    assistantOutput: error,
    finalHead: null,
    gitStatus: null,
    diffStat: null,
    setupEnforcement: repo.setupEnforcement,
    evidenceError: error,
  }
}

function failedActivationOutcome(
  repo: PreparedRepository,
  childSessionId: string,
  runId: SubagentRunId,
  error: string,
): RepositoryOutcome {
  return {
    execution: 'result-error',
    workspaceId: String(repo.workspace.id),
    workspaceTitle: repo.workspace.title,
    sourceRoot: repo.root,
    sourceGitIdentity: repo.commonGitDirectory,
    sourceHead: repo.head,
    sourceBranch: repo.branch,
    cloneRoot: repo.cloneRoot,
    childBranch: repo.childBranch,
    childSessionId,
    runId,
    stopReason: 'execution-error',
    assistantOutput: error,
    finalHead: null,
    gitStatus: null,
    diffStat: null,
    setupEnforcement: repo.setupEnforcement,
    evidenceError: error,
  }
}

function baseOutcome(
  repo: PreparedRepository,
  childSessionId: string,
  runId: SubagentRunId,
  result: SubagentResult,
  finalHead: string | null,
  gitStatus: string | null,
  diffStat: string | null,
  evidenceError?: string,
): RepositoryOutcome {
  return {
    execution: 'result',
    workspaceId: String(repo.workspace.id),
    workspaceTitle: repo.workspace.title,
    sourceRoot: repo.root,
    sourceGitIdentity: repo.commonGitDirectory,
    sourceHead: repo.head,
    sourceBranch: repo.branch,
    cloneRoot: repo.cloneRoot,
    childBranch: repo.childBranch,
    childSessionId,
    runId,
    stopReason: result.stopReason,
    assistantOutput: result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
    finalHead,
    gitStatus,
    diffStat,
    setupEnforcement: repo.setupEnforcement,
    ...evidenceError === undefined ? {} : { evidenceError },
  }
}

function isPathUnder(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function pathsOverlap(left: string, right: string): boolean {
  return isPathUnder(left, right) || isPathUnder(right, left)
}

function samePath(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === ''
}

/** Narrow one lossless JSON value to an object record. */
function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Narrow one JSON value to an array. */
function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value)
}

/** Read one string property from a JSON record. */
function stringField(record: Record<string, JsonValue>, name: string): string | undefined {
  const value = record[name]
  return typeof value === 'string' ? value : undefined
}

/** Read one nullable string property from a JSON record. */
function nullableStringField(record: Record<string, JsonValue>, name: string): string | null | undefined {
  const value = record[name]
  return value === null || typeof value === 'string' ? value : undefined
}
