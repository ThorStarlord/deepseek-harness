/** Captured repository evidence and its reviewer prompts. @module @deepseek-ai/dsh-command-code-review/render */

import { createHash } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'

const SENSITIVE_SUFFIX = /\.(?:pem|key|p12|pfx)$/iu
const SENSITIVE_PREFIX = /^(?:credentials|secrets?)(?:\.|$)/iu
const PRIVATE_KEY = /^id_(?:rsa|ed25519)/iu

/** Marker used to identify a repository review handoff in the parent Session. */
export const HANDOFF_MARKER = '[DSH code review handoff]'

/** Evidence packet captured from one live Git working tree. */
export interface RepositorySnapshot {
  readonly branch: string | null
  readonly head: string
  readonly status: string
  readonly stagedPaths: readonly string[]
  readonly unstagedPaths: readonly string[]
  readonly untrackedPaths: readonly string[]
  readonly instructions: readonly { readonly path: string; readonly content: string }[]
  readonly stagedDiffs: readonly { readonly path: string; readonly content: string }[]
  readonly unstagedDiffs: readonly { readonly path: string; readonly content: string }[]
  readonly untrackedFiles: readonly { readonly path: string; readonly content: string }[]
  readonly omittedSensitivePaths: number
  readonly omittedBinaryFiles: number
}

/** Repository identity and immutable content packet captured for one review run. */
export interface CapturedRepository {
  readonly root: string
  readonly branch: string | null
  readonly head: string
  readonly packet: string
  readonly digest: string
  readonly observedAt: string
  readonly hasReviewableChanges: boolean
}

/** Split a NUL-delimited Git path list and discard the empty terminator.
 * @param value - Git output containing paths separated by NUL bytes.
 * @returns non-empty repository-relative paths.
 */
export function splitNul(value: string): string[] {
  return value.split('\0').filter(path => path.length > 0)
}

/** Identify likely secret-bearing names that review packets omit.
 * @param path - repository-relative path to classify.
 * @returns whether a path segment matches a sensitive-name rule.
 */
export function isSensitivePath(path: string): boolean {
  return path.replaceAll('\\', '/').split('/').some((segment) => {
    const lowered = segment.toLowerCase()
    return lowered === '.env' || lowered.startsWith('.env.')
      || SENSITIVE_SUFFIX.test(lowered)
      || SENSITIVE_PREFIX.test(lowered)
      || PRIVATE_KEY.test(lowered)
  })
}

/** Identify Git metadata paths that must not enter review evidence.
 * @param path - repository-relative path to classify.
 * @returns whether the first path segment is `.git`.
 */
export function isGitMetadataPath(path: string): boolean {
  return path.replaceAll('\\', '/').split('/')[0]?.toLowerCase() === '.git'
}

/** Hash the complete repository observation so later capture can detect stale evidence.
 * @param root - canonical repository root.
 * @param snapshot - captured index, working-tree, instruction, and diff evidence.
 * @returns a SHA-256 digest of the serialized observation.
 */
export function digestSnapshot(root: string, snapshot: RepositorySnapshot): string {
  return createHash('sha256').update(JSON.stringify({
    root,
    branch: snapshot.branch,
    head: snapshot.head,
    status: snapshot.status,
    stagedPaths: snapshot.stagedPaths,
    unstagedPaths: snapshot.unstagedPaths,
    untrackedPaths: snapshot.untrackedPaths,
    instructions: snapshot.instructions,
    stagedDiffs: snapshot.stagedDiffs,
    unstagedDiffs: snapshot.unstagedDiffs,
    untrackedFiles: snapshot.untrackedFiles,
    omittedSensitivePaths: snapshot.omittedSensitivePaths,
    omittedBinaryFiles: snapshot.omittedBinaryFiles,
  })).digest('hex')
}

/** Render the captured Git state and repository instructions for a reviewer.
 * @param root - canonical repository root.
 * @param snapshot - captured Git and file evidence.
 * @returns the model-visible review packet.
 */
export function renderRepositoryPacket(root: string, snapshot: RepositorySnapshot): string {
  const sections = [
    `Repository: ${root}`,
    `Branch: ${snapshot.branch ?? '(detached HEAD)'}`,
    `Committed HEAD: ${snapshot.head}`,
    'Observation: captured live Git index and working-tree content; this is not an immutable filesystem snapshot.',
    `Index paths (${snapshot.stagedPaths.length}): ${snapshot.stagedPaths.join(', ') || '(none)'}`,
    `Working-tree paths (${snapshot.unstagedPaths.length}): ${snapshot.unstagedPaths.join(', ') || '(none)'}`,
    `Untracked, non-ignored paths (${snapshot.untrackedPaths.length}): ${snapshot.untrackedPaths.join(', ') || '(none)'}`,
    `Sensitive-name paths omitted: ${snapshot.omittedSensitivePaths}; binary or non-regular untracked files omitted: ${snapshot.omittedBinaryFiles}.`,
    ...snapshot.instructions.map(row => `### Repository instructions: ${row.path}\n${row.content}`),
    ...snapshot.stagedDiffs.map(row => `### Staged diff: ${row.path}\n${row.content}`),
    ...snapshot.unstagedDiffs.map(row => `### Unstaged diff: ${row.path}\n${row.content}`),
    ...snapshot.untrackedFiles.map(row => `### Untracked file: ${row.path}\n${numberLines(row.content)}`),
  ]
  return sections.join('\n\n')
}

/** Construct a read-only reviewer prompt with optional user focus.
 * @param repository - captured repository identity and packet.
 * @param focus - optional user-provided review focus.
 * @returns the reviewer prompt.
 */
export function renderReviewerPrompt(repository: CapturedRepository, focus: string): string {
  return [
    'Load the `code-review` Skill before reviewing this captured repository packet.',
    'Review only the supplied content. You have no repository tools except the Skill loader.',
    'Do not modify files, request more tools, or delegate. Report findings with severity, repository-relative path and line, confidence, and the supplied evidence. If no actionable issue is supported, say that no findings are supported.',
    focus.length === 0 ? '' : `User review focus: ${focus}`,
    repository.packet,
  ].filter(part => part.length > 0).join('\n\n')
}

/** Render one reviewer result for the coordinating Agent and preserve its evidence attribution.
 * @param repository - captured repository identity and revision.
 * @param childId - reviewer Session identifier.
 * @param runId - reviewer run identifier, when the provider reported one.
 * @param findings - reviewer output text.
 * @param sourceChanged - whether a later live capture differed from the captured packet.
 * @param stopReason - reviewer terminal reason.
 * @returns an attributed parent handoff message.
 */
export function renderParentHandoff(
  repository: CapturedRepository,
  childId: SessionId,
  runId: SubagentRunId | undefined,
  findings: string,
  sourceChanged: boolean,
  stopReason: string,
): string {
  return [
    HANDOFF_MARKER,
    `Repository: ${repository.root}`,
    `Branch: ${repository.branch ?? '(detached HEAD)'}`,
    `Committed HEAD: ${repository.head}`,
    `Captured at: ${repository.observedAt}`,
    `Working tree changed during review: ${sourceChanged ? 'yes' : 'no'}`,
    `Reviewer Session: ${String(childId)}`,
    `Reviewer run: ${runId === undefined ? 'not reported' : String(runId)}`,
    `Reviewer stop reason: ${stopReason}`,
    'Findings from the captured source:',
    findings,
  ].join('\n\n')
}

/** Collect only text blocks from reviewer output.
 * @param output - reviewer content blocks.
 * @returns concatenated, trimmed text content.
 */
export function outputText(output: readonly ContentBlock[]): string {
  return output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

/** Render unknown thrown values for a user-facing command error.
 * @param error - thrown value.
 * @returns an error message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function numberLines(value: string): string {
  return value.split(/\r?\n/u).map((line, index) => `${index + 1}: ${line}`).join('\n')
}
