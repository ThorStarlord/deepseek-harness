/** Human commands and read-only rendering for Activity artifact pointers.
 * @module @deepseek-ai/dsh-command-home-activity/artifact-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { ActivityArtifactError, ActivityArtifactStorageError } from '@deepseek-ai/dsh-home-activity/artifacts'
import { activityDelegationId } from '@deepseek-ai/dsh-home-activity/delegations'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

const USAGE = 'Usage: /activity artifact add <activity-id> <delegation-id> <workspace-id> <JSON>'
const MAX_INPUT_BYTES = 16_384
const safeText = z.string().trim().min(1).max(2048).regex(/^[^\p{Cc}]+$/u)
const artifactInputSchema = z.object({
  label: z.string().trim().min(1).max(160).regex(/^[^\p{Cc}]+$/u),
  location: safeText,
  revision: z.string().trim().min(1).max(256).regex(/^[^\p{Cc}]+$/u).optional(),
}).strict()

type ParsedCommand =
  | { readonly kind: 'add'; readonly activityId: string; readonly delegationId: string; readonly workspaceId: string; readonly input: string }
  | { readonly kind: 'invalid'; readonly message: string }

/** Execute artifact-pointer commands owned by the existing `/activity` command. */
export async function executeActivityArtifactCommand(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult | undefined> {
  const parsed = parse(invocation.rawInput)
  if (parsed === undefined) return undefined
  if (parsed.kind === 'invalid') return { kind: 'error', text: parsed.message }
  const activityId = z.uuid().safeParse(parsed.activityId)
  if (!activityId.success) return { kind: 'error', text: `Activity id must be a UUID. ${USAGE}` }
  const delegationId = z.uuid().safeParse(parsed.delegationId)
  if (!delegationId.success) return { kind: 'error', text: `Delegation id must be a UUID. ${USAGE}` }
  const workspaceId = z.uuid().safeParse(parsed.workspaceId)
  if (!workspaceId.success) return { kind: 'error', text: `Workspace id must be a UUID. ${USAGE}` }

  let input: unknown
  try {
    input = JSON.parse(parsed.input)
  } catch {
    return { kind: 'error', text: `Artifact details must be valid JSON. ${USAGE}` }
  }
  const details = artifactInputSchema.safeParse(input)
  if (!details.success) {
    return { kind: 'error', text: `Artifact details are invalid: ${details.error.issues.map(issue => issue.message).join('; ')}` }
  }

  try {
    const artifact = await ctx.homeActivityArtifacts.create({
      activityId: ActivityId(activityId.data),
      delegationId: activityDelegationId(delegationId.data),
      workspaceId: WorkspaceId(workspaceId.data),
      ...details.data,
    })
    const delegation = ctx.homeActivityDelegations.get(artifact.delegationId)
    return {
      kind: 'success',
      text: [
        `Artifact reference recorded: ${artifact.label}`,
        `ID: ${artifact.id}`,
        `Activity: ${artifact.activityId}`,
        `Delegation: ${artifact.delegationId}`,
        `Requesting Session: ${delegation?.request.parentSessionId ?? 'unavailable'}`,
        `User-selected Workspace context: ${artifact.workspaceId}`,
        `Source location: ${artifact.location}`,
        `Source revision: ${artifact.revision ?? 'unknown'}`,
        'This is a user-linked pointer only; it does not verify execution context, output, producer, or acceptance, and it does not perform repository operations.',
      ].join('\n'),
    }
  } catch (error: unknown) {
    if (error instanceof ActivityArtifactError) {
      const recovery = error.code === 'unknown-activity'
        ? 'Run /activity list to choose a saved Activity id.'
        : error.code === 'unknown-delegation'
          ? `Run /activity open ${activityId.data} to choose a saved delegation id.`
          : error.code === 'delegation-activity-mismatch'
            ? 'Choose a delegation recorded for this Activity.'
            : error.code === 'workspace-not-linked'
              ? `Link the intended Workspace first with /activity link ${activityId.data} workspace <workspace-id>.`
              : error.code === 'unknown-workspace'
                ? 'Run /activity workspaces to choose a registered Workspace id.'
                : error.code === 'artifact-limit'
                  ? `Run /activity open ${activityId.data} to inspect saved references.`
                  : `Check the label, location, and optional revision. ${USAGE}`
      return { kind: 'error', text: `${error.message} ${recovery}` }
    }
    if (error instanceof ActivityArtifactStorageError || error instanceof StorageError) {
      ctx.logger.warn('command-home-activity: artifact reference persistence failed: %o', error)
      return { kind: 'error', text: `Artifact reference storage failed; no pointer was confirmed. Run /activity open ${activityId.data} before retrying.` }
    }
    ctx.logger.warn('command-home-activity: artifact reference could not be recorded: %o', error)
    return { kind: 'error', text: 'The selected Activity, delegation, or Workspace could not be confirmed; no pointer was recorded.' }
  }
}

/**
 * Render saved pointers with the user-selected Workspace and requesting Session kept distinct.
 * @param ctx - Plugin context for artifact, Workspace, and delegation reads.
 * @param activityId - Stable Activity identity.
 * @returns User-linked pointer lines; missing revision data is stated as unknown.
 */
export function renderActivityArtifacts(ctx: Context, activityId: ReturnType<typeof ActivityId>): readonly string[] {
  let artifacts: ReturnType<Context['homeActivityArtifacts']['list']>
  try {
    artifacts = ctx.homeActivityArtifacts.list(activityId)
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: artifact reference catalog read failed: %o', error)
    return Object.freeze(['Artifact references could not be read; no current pointer state was confirmed.'])
  }
  const lines = ['User-linked artifact references (not verified outputs):']
  if (artifacts.length === 0) {
    lines.push('No artifact references.')
    return Object.freeze(lines)
  }
  lines.push('Workspace contexts are independent; no shared checkout or Git root is inferred.')
  for (const artifact of artifacts) {
    lines.push(`Artifact reference: ${artifact.label} — ${artifact.id}`)
    const associations = ctx.homeActivityAssociations.get(activityId)
    if (!associations.workspaceIds.includes(artifact.workspaceId)) {
      lines.push(`User-selected Workspace context no longer linked to this Activity: ${artifact.workspaceId}.`)
    } else {
      const workspace = ctx.workspaceRegistry.get(artifact.workspaceId)
      lines.push(workspace === undefined
        ? `User-selected Workspace context unavailable: ${artifact.workspaceId}.`
        : `User-selected Workspace context (execution Workspace unverified): ${workspace.title} — ${workspace.id}`)
      if (workspace !== undefined) lines.push(`Workspace directory: ${workspace.path}`)
    }
    const delegation = ctx.homeActivityDelegations.get(artifact.delegationId)
    if (delegation === undefined || delegation.activityId !== activityId) {
      lines.push(`Delegation reference unavailable: ${artifact.delegationId}.`)
    } else {
      lines.push(`Delegation: ${artifact.delegationId} (${delegation.request.provider}; ${delegation.status})`)
      lines.push(`Requesting Session: ${delegation.request.parentSessionId}`)
    }
    lines.push(`Source location: ${artifact.location}`)
    lines.push(`Source revision: ${artifact.revision ?? 'unknown'}`)
    lines.push('Reference recorded by user command; its producer and contents are not independently verified.')
  }
  return Object.freeze(lines)
}

function parse(rawInput: string): ParsedCommand | undefined {
  if (Buffer.byteLength(rawInput, 'utf8') > MAX_INPUT_BYTES) {
    return /^artifact(?:\s|$)/u.test(rawInput.trim())
      ? { kind: 'invalid', message: `Artifact command input must not exceed ${MAX_INPUT_BYTES} bytes. ${USAGE}` }
      : undefined
  }
  const input = rawInput.trim()
  if (!/^artifact(?:\s|$)/u.test(input)) return undefined
  const match = /^artifact\s+add\s+(\S+)\s+(\S+)\s+(\S+)\s+([\s\S]+)$/u.exec(input)
  return match?.[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined
    ? { kind: 'invalid', message: USAGE }
    : { kind: 'add', activityId: match[1], delegationId: match[2], workspaceId: match[3], input: match[4] }
}
