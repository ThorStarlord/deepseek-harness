/** Read-only, findings-first review of the current authorized Git working tree. @module @deepseek-ai/dsh-command-code-review */

import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, sep } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assertReadOnlyGitCommand, gitNullDevice } from './git-command.ts'
import { sameRepositoryPath } from './repository-path.ts'
import {
  digestSnapshot,
  errorMessage,
  HANDOFF_MARKER,
  isGitMetadataPath,
  isSensitivePath,
  outputText,
  renderParentHandoff,
  renderRepositoryPacket,
  renderReviewerPrompt,
  splitNul,
} from './render.ts'
import type { CapturedRepository, RepositorySnapshot } from './render.ts'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-agent-loop'

/** Cordis plugin name used by the standard Web preset. */
export const name = 'command-code-review'
/** Services used to capture a repository packet and run a restricted reviewer. */
export const inject = ['commands', 'agents', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess', 'fs', 'subagents']

/** Review limits and the optional advisory handoff hook. */
export interface Config {
  /** Maximum bytes retained in one review packet. */
  readonly maxPacketBytes: number
  /** Maximum changed files captured, including ordinary untracked files. */
  readonly maxChangedFiles: number
  /** Maximum bytes read from each repository instruction file. */
  readonly maxInstructionBytes: number
  /** Maximum bytes returned by the reviewer before the command reports an error. */
  readonly maxResultBytes: number
  /** Add an advisory evidence reminder when review results return to the parent. */
  readonly evidenceReminder: boolean
}

/** Resolved review configuration. */
export const Config = z.object({
  maxPacketBytes: z.number().default(524_288),
  maxChangedFiles: z.number().default(100),
  maxInstructionBytes: z.number().default(16_384),
  maxResultBytes: z.number().default(65_536),
  evidenceReminder: z.boolean().default(true),
})

const REVIEW_COMMAND = 'review'
const REVIEW_PRESET = 'code-reviewer'
const REVIEWER_PROVIDER = 'spawn'
const REVIEW_TOOLS = ['skill'] as const
const REVIEW_INSTRUCTIONS = ['AGENTS.md', 'CLAUDE.md'] as const
const MAX_PACKET_LIMIT_BYTES = 8 * 1024 * 1024
const MAX_CHANGED_FILES_LIMIT = 1_000
const MAX_INSTRUCTION_LIMIT_BYTES = 65_536
const MAX_RESULT_LIMIT_BYTES = 262_144
interface GitResult {
  readonly stdout: string
  readonly exitCode: number | null
}

type ReviewInvocationContext = Context

/** Structured failure returned to the invoking command. */
class CodeReviewError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'CodeReviewError'
  }
}

/** Register `/review` and its evidence-only AgentLoop hook. */
export function apply(ctx: Context, config: Config): void {
  assertConfiguration(config)
  const runtime = ctx
  ctx.effect(() => ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-code-review'),
    name: REVIEW_COMMAND,
    description: 'Review staged, unstaged, and untracked changes in the current Git repository',
    input: { hint: '[review focus]' },
    handler: invocation => executeReview(runtime, config, invocation),
  }))

  ctx.on('agent/pre-step', async ({ messages }, next): Promise<PreStepDecision> => {
    const handoff = messages.some(message => message.content.some(block => (
      block.type === 'text' && block.text.startsWith(HANDOFF_MARKER)
    )))
    const downstream = await next()
    if (!config.evidenceReminder || !handoff || downstream.kind !== 'enter') return downstream
    return {
      ...downstream,
      messages: [...downstream.messages, createUserMessage({
        content: [{
          type: 'text',
          text: 'Review handoff guidance: attribute each finding to the captured repository, HEAD, branch, reviewer Session, run, and source path:line. Cite supplied evidence, separate findings from uncertainty, and report whether the live source changed during review. This reminder is advisory and grants no tool or permission authority.',
        }],
        source: { kind: 'user' },
      })],
    }
  })
}

async function executeReview(
  ctx: ReviewInvocationContext,
  config: Config,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const focus = invocation.rawInput.trim()
  if (Buffer.byteLength(focus, 'utf8') > 4_096) {
    return { kind: 'error', text: 'Review focus must not exceed 4,096 bytes.' }
  }
  const parent = invocation.agent
  if (ctx.agents.get(parent.id) !== parent || parent.ctx.fiber.state !== FiberState.ACTIVE) {
    return { kind: 'error', text: 'Code review requires a live parent Agent.' }
  }
  if (parent.session.header.parentSession !== undefined) {
    return { kind: 'error', text: 'Code review can start only from a user-started conversation.' }
  }

  try {
    const first = await captureRepository(ctx, parent, config, invocation.signal)
    if (!first.hasReviewableChanges) {
      return { kind: 'success', text: `No reviewable changes were found in ${first.root}.` }
    }
    invocation.signal.throwIfAborted()
    const childId = SessionId(randomUUID())
    let runId: SubagentRunId | undefined
    const observeRun = ctx.on('subagent/start', (event) => {
      if (event.id === childId) runId = event.runId
    })
    let activation: Awaited<ReturnType<typeof ctx.subagents.startActivation>> | undefined
    let removeAbort: (() => void) | undefined
    let resultText = ''
    let stopReason = 'startup-error'
    try {
      activation = await ctx.subagents.startActivation({
        provider: REVIEWER_PROVIDER,
        childId,
        label: 'code-review',
        cwd: first.root,
        agentPreset: REVIEW_PRESET,
        readOnly: true,
        toolFilter: { allow: REVIEW_TOOLS },
        prompt: [{ type: 'text', text: renderReviewerPrompt(first, focus) }],
        parent,
        signal: invocation.signal,
        delivery: 'caller',
      })
      const disposeOnAbort = (): void => {
        void activation?.dispose().catch((error: unknown) => {
          ctx.logger.warn('command-code-review: reviewer cleanup after cancellation failed: %o', error)
        })
      }
      removeAbort = () => {
        invocation.signal.removeEventListener('abort', disposeOnAbort)
      }
      invocation.signal.addEventListener('abort', disposeOnAbort, { once: true })
      if (invocation.signal.aborted) disposeOnAbort()
      const result = await activation.result
      stopReason = result.stopReason
      resultText = outputText(result.output)
      if (result.stopReason !== 'completed') {
        return {
          kind: 'error',
          text: `Reviewer ${String(childId)} stopped with ${result.stopReason}; no findings were forwarded. ${result.diagnostic ?? ''}`.trim(),
        }
      }
      if (Buffer.byteLength(resultText, 'utf8') > config.maxResultBytes) {
        return { kind: 'error', text: `Reviewer result exceeded the ${config.maxResultBytes}-byte limit; no findings were forwarded.` }
      }
    } finally {
      removeAbort?.()
      observeRun()
      if (activation !== undefined) await activation.dispose()
    }

    invocation.signal.throwIfAborted()
    const after = await captureRepository(ctx, parent, config, invocation.signal)
    const sourceChanged = first.digest !== after.digest
    const handoff = renderParentHandoff(first, childId, runId, resultText, sourceChanged, stopReason)
    parent.steer(createUserMessage({
      content: [{ type: 'text', text: handoff }],
      source: { kind: 'user' },
    }))
    return {
      kind: 'success',
      text: `Read-only review completed for ${first.root}; reviewer Session ${String(childId)}, run ${runId === undefined ? 'not reported' : String(runId)}. ${sourceChanged ? 'The working tree changed during review; the parent response will identify the captured revision as stale.' : 'The captured source state remained unchanged during review.'}`,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) throw error
    if (error instanceof CodeReviewError) return { kind: 'error', text: error.message }
    ctx.logger.warn('command-code-review: failed to capture or reconcile the repository review: %o', error)
    return { kind: 'error', text: `Code review could not complete: ${errorMessage(error)}` }
  }
}

async function captureRepository(
  ctx: ReviewInvocationContext,
  agent: Agent,
  config: Config,
  signal: AbortSignal,
): Promise<CapturedRepository> {
  const requestedCwd = ctx.workingDirectory.get(agent.session)
  const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
  const authorizedRoot = await ctx.fs.resolve(policy.workspaceRoot, { signal })
  const requestedTarget = await ctx.fs.resolve(requestedCwd, { signal })
  if (!ctx.fs.contains(authorizedRoot, requestedTarget)) {
    throw new CodeReviewError('The current working directory is outside this Session’s authorized repository root.', 'REVIEW_ROOT_NOT_AUTHORIZED')
  }
  const rootResult = await runGit(ctx, requestedCwd, ['rev-parse', '--show-toplevel'], config.maxPacketBytes, signal)
  const rootText = rootResult.stdout.trim()
  if (rootText.length === 0 || !isAbsolute(rootText)) {
    throw new CodeReviewError('Git did not return an absolute repository root for the current directory.', 'REVIEW_REPOSITORY_NOT_FOUND')
  }
  const rootTarget = await ctx.fs.resolve(rootText, { signal })
  if (!ctx.fs.contains(authorizedRoot, rootTarget)) {
    throw new CodeReviewError('The Git repository is outside this Session’s authorized repository root.', 'REVIEW_ROOT_NOT_AUTHORIZED')
  }
  const root = ctx.fs.processPath(rootTarget)
  const before = await captureSnapshot(ctx, root, config, signal)
  const packet = renderRepositoryPacket(root, before)
  if (Buffer.byteLength(packet, 'utf8') > config.maxPacketBytes) {
    throw new CodeReviewError(`Review packet exceeds the configured ${config.maxPacketBytes}-byte limit.`, 'REVIEW_PACKET_TOO_LARGE')
  }
  const after = await captureSnapshot(ctx, root, config, signal)
  const digest = digestSnapshot(root, before)
  if (digest !== digestSnapshot(root, after)) {
    throw new CodeReviewError('Repository source changed while the review packet was being captured; run /review again after edits settle.', 'REVIEW_SOURCE_CHANGED_DURING_CAPTURE')
  }
  return {
    root,
    branch: before.branch,
    head: before.head,
    packet,
    digest,
    observedAt: new Date().toISOString(),
    hasReviewableChanges: before.stagedPaths.length + before.unstagedPaths.length + before.untrackedFiles.length > 0,
  }
}

async function captureSnapshot(
  ctx: ReviewInvocationContext,
  root: string,
  config: Config,
  signal: AbortSignal,
): Promise<RepositorySnapshot> {
  const rootResult = await runGit(ctx, root, ['rev-parse', '--show-toplevel'], config.maxPacketBytes, signal)
  const canonical = ctx.fs.processPath(await ctx.fs.resolve(rootResult.stdout.trim(), { signal }))
  if (!sameRepositoryPath(root, canonical)) throw new CodeReviewError('Git repository identity changed during review capture.', 'REVIEW_REPOSITORY_CHANGED')
  const [headResult, branchResult, statusResult, stagedNames, unstagedNames, untrackedNames] = await Promise.all([
    runGit(ctx, root, ['rev-parse', 'HEAD'], config.maxPacketBytes, signal),
    runGit(ctx, root, ['branch', '--show-current'], config.maxPacketBytes, signal),
    runGit(ctx, root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '--ignored=no'], config.maxPacketBytes, signal),
    runGit(ctx, root, ['--literal-pathspecs', 'diff', '--name-only', '-z', '--cached', '--no-renames'], config.maxPacketBytes, signal),
    runGit(ctx, root, ['--literal-pathspecs', 'diff', '--name-only', '-z', '--no-renames'], config.maxPacketBytes, signal),
    runGit(ctx, root, ['ls-files', '--others', '--exclude-standard', '-z'], config.maxPacketBytes, signal),
  ])
  const stagedAll = splitNul(stagedNames.stdout)
  const unstagedAll = splitNul(unstagedNames.stdout)
  const untrackedAll = splitNul(untrackedNames.stdout)
  const all = [...new Set([...stagedAll, ...unstagedAll, ...untrackedAll])]
  const safe = all.filter(path => !isSensitivePath(path) && !isGitMetadataPath(path))
  if (safe.length > config.maxChangedFiles) {
    throw new CodeReviewError(`Found ${safe.length} reviewable changed files; the configured limit is ${config.maxChangedFiles}. Narrow the changes or raise the limit.`, 'REVIEW_TOO_MANY_FILES')
  }
  const stagedPaths = stagedAll.filter(path => !isSensitivePath(path) && !isGitMetadataPath(path))
  const unstagedPaths = unstagedAll.filter(path => !isSensitivePath(path) && !isGitMetadataPath(path))
  const untrackedPaths = untrackedAll.filter(path => !isSensitivePath(path) && !isGitMetadataPath(path))
  const [instructions, stagedDiffs, unstagedDiffs, untrackedFiles] = await Promise.all([
    readInstructions(ctx, root, safe, config.maxInstructionBytes, signal, config.maxPacketBytes),
    readDiffs(ctx, root, stagedPaths, true, config.maxPacketBytes, signal),
    readDiffs(ctx, root, unstagedPaths, false, config.maxPacketBytes, signal),
    readUntrackedFiles(ctx, root, untrackedPaths, config.maxPacketBytes, signal),
  ])
  return {
    branch: branchResult.stdout.trim() || null,
    head: headResult.stdout.trim(),
    status: statusResult.stdout,
    stagedPaths,
    unstagedPaths,
    untrackedPaths,
    instructions,
    stagedDiffs,
    unstagedDiffs,
    untrackedFiles: untrackedFiles.files,
    omittedSensitivePaths: all.length - safe.length,
    omittedBinaryFiles: untrackedFiles.omittedBinaryFiles,
  }
}

async function readDiffs(
  ctx: ReviewInvocationContext,
  root: string,
  paths: readonly string[],
  staged: boolean,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ readonly path: string; readonly content: string }[]> {
  const results: { path: string; content: string }[] = []
  for (const path of paths) {
    const stageFlag = staged ? ['--cached'] : []
    const result = await runGit(ctx, root, [
      '--literal-pathspecs', 'diff', ...stageFlag,
      '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=40', '--', path,
    ], maxBytes, signal)
    if (result.stdout.length > 0) results.push({ path, content: result.stdout })
  }
  return results
}

async function readUntrackedFiles(
  ctx: ReviewInvocationContext,
  root: string,
  paths: readonly string[],
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ readonly files: readonly { readonly path: string; readonly content: string }[]; readonly omittedBinaryFiles: number }> {
  const files: { path: string; content: string }[] = []
  let omittedBinaryFiles = 0
  const rootTarget = await ctx.fs.resolve(root, { signal })
  for (const path of paths) {
    signal.throwIfAborted()
    const lexical = await ctx.fs.lstat(path, { cwd: root }, signal)
    if (lexical?.type !== 'file') {
      omittedBinaryFiles += 1
      continue
    }
    const target = await ctx.fs.resolve(path, { cwd: root, signal })
    if (!ctx.fs.contains(rootTarget, target)) {
      throw new CodeReviewError(`Untracked path ${JSON.stringify(path)} resolves outside the selected repository.`, 'REVIEW_UNTRACKED_PATH_OUTSIDE_ROOT')
    }
    const info = await ctx.fs.stat(target, signal)
    if (info?.type !== 'file') {
      omittedBinaryFiles += 1
      continue
    }
    const read = await readBoundedText(ctx, target, signal, maxBytes)
    if (read.kind === 'too-large') {
      throw new CodeReviewError(`Untracked file ${JSON.stringify(path)} exceeds the review packet limit.`, 'REVIEW_FILE_TOO_LARGE')
    }
    if (read.kind === 'binary') {
      omittedBinaryFiles += 1
      continue
    }
    files.push({ path, content: read.text })
  }
  return { files, omittedBinaryFiles }
}

async function readInstructions(
  ctx: ReviewInvocationContext,
  root: string,
  paths: readonly string[],
  maxInstructionBytes: number,
  signal: AbortSignal,
  maxOutputBytes: number,
): Promise<{ readonly path: string; readonly content: string }[]> {
  const directories = new Set<string>(['.'])
  for (const path of paths) {
    let current = dirname(path.replaceAll('/', sep))
    while (current !== '.' && current !== '') {
      directories.add(current)
      current = dirname(current)
    }
  }
  const rootTarget = await ctx.fs.resolve(root, { signal })
  const found = new Map<string, string>()
  for (const directory of [...directories].sort()) {
    for (const name of REVIEW_INSTRUCTIONS) {
      const relativePath = directory === '.' ? name : `${directory.split(sep).join('/')}/${name}`
      const ignored = await runGit(ctx, root, ['check-ignore', '--no-index', '-q', '--', relativePath], maxOutputBytes, signal, [0, 1])
      if (ignored.exitCode === 0) continue
      const lexical = await ctx.fs.lstat(relativePath, { cwd: root }, signal)
      if (lexical?.type !== 'file') continue
      const target = await ctx.fs.resolve(relativePath, { cwd: root, signal })
      if (!ctx.fs.contains(rootTarget, target)) continue
      const info = await ctx.fs.stat(target, signal)
      if (info?.type !== 'file') continue
      const read = await readBoundedText(ctx, target, signal, maxInstructionBytes)
      if (read.kind !== 'text') continue
      found.set(relativePath, read.text)
    }
  }
  return [...found].map(([path, content]) => ({ path, content }))
}

async function readBoundedText(
  ctx: ReviewInvocationContext,
  target: Awaited<ReturnType<ReviewInvocationContext['fs']['resolve']>>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ readonly kind: 'text'; readonly text: string } | { readonly kind: 'binary' } | { readonly kind: 'too-large' }> {
  let bytes: Uint8Array
  try {
    bytes = await ctx.fs.readBytes(target, signal, maxBytes)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'FS_TOO_LARGE') return { kind: 'too-large' }
    throw error
  }
  if (bytes.includes(0)) return { kind: 'binary' }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    return { kind: 'text', text: decoder.decode(bytes) }
  } catch {
    return { kind: 'binary' }
  }
}

async function runGit(
  ctx: ReviewInvocationContext,
  cwd: string,
  args: readonly string[],
  maxOutputBytes: number,
  signal: AbortSignal,
  acceptedExitCodes: readonly number[] = [0],
): Promise<GitResult> {
  assertReadOnlyGitCommand(args)
  const confinedPolicy: SandboxPolicy = { mode: 'read-only', workspaceRoot: cwd }
  const confined = await ctx.sandbox.confine(['git', ...args], confinedPolicy, signal)
  const device = gitNullDevice(process.platform)
  const argv = confined.enforcement === 'full' ? confined.argv : ['git', ...args]
  const handle = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: maxOutputBytes },
      stderr: { maxBytes: 16_384 },
    },
    graceMs: 5_000,
    signal,
    env: {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: device,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'core.hooksPath',
      GIT_CONFIG_VALUE_1: device,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: device,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_COMMON_DIR: undefined,
      GIT_PREFIX: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_NO_REPLACE_OBJECTS: '1',
    },
  })
  const outcome = await handle.done
  await handle.waitForExit(signal)
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout?.lossy === true || stderr?.lossy === true) {
    throw new CodeReviewError('Git review output exceeded the configured capture limit.', 'REVIEW_GIT_OUTPUT_TOO_LARGE')
  }
  if (outcome.exitCode === null || !acceptedExitCodes.includes(outcome.exitCode)) {
    throw new CodeReviewError(`Git could not read the current repository state: ${stderr?.text.trim() || args.join(' ')}`, 'REVIEW_GIT_FAILED')
  }
  return { stdout: stdout?.text ?? '', exitCode: outcome.exitCode }
}

function assertConfiguration(config: Config): void {
  const bounds = [
    ['maxPacketBytes', config.maxPacketBytes, MAX_PACKET_LIMIT_BYTES],
    ['maxChangedFiles', config.maxChangedFiles, MAX_CHANGED_FILES_LIMIT],
    ['maxInstructionBytes', config.maxInstructionBytes, MAX_INSTRUCTION_LIMIT_BYTES],
    ['maxResultBytes', config.maxResultBytes, MAX_RESULT_LIMIT_BYTES],
  ] as const
  for (const [name, value, maximum] of bounds) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`command-code-review: ${name} must be an integer between 1 and ${maximum}`)
    }
  }
}
