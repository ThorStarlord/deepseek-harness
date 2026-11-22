/**
 * Human commands for saved Home Activities and explicit DSH-native delegation.
 * @module @deepseek-ai/dsh-command-home-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { StorageError } from '@deepseek-ai/dsh-storage'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { ActivityError, ActivityId, createActivityRequestSchema } from '@deepseek-ai/dsh-home-activity'
import {
  cancelActivityStrategicAssessment,
  executeActivityStrategicAssessment,
  registerActivityStrategicBriefTool,
  renderActivityStrategicEpisodes,
} from './strategic-command.ts'
import { executeActivityDelegation, renderActivityDelegation } from './delegation-command.ts'
import { executeActivityContinuation } from './continuation-command.ts'
import { renderActivityNextActions } from './next-actions.ts'
import { executeAssociationCommand, renderActivityAssociations } from './association-command.ts'
import { executeActivityHandoffCommand, renderActivityHandoffs } from './handoff-command.ts'
import { executeActivityAnnotationCommand, renderActivityAnnotations } from './annotation-command.ts'
import { executeActivityReviewCommand, renderActivityReview } from './review-command.ts'

export const name = 'command-home-activity'
export const inject = [
  'commands',
  'tools',
  'agents',
  'homeActivities',
  'homeActivityStrategicEpisodes',
  'homeActivityDelegations',
  'subagents',
  'homeActivityAssociations',
  'homeActivityArtifacts',
  'homeActivityHandoffs',
  'homeActivityReviews',
  'homeActivityAnnotations',
  'workspaceRegistry',
  'sessionPersistence',
]

const USAGE = 'Usage: /activity create <JSON> | list | open <activity-id> | brief <activity-id> <revision> | assess cancel | assess <activity-id> <workspace-id> <workspace-id> | workspaces | sessions | link/unlink <activity-id> workspace|session <context-id> | artifact add <activity-id> <delegation-id> <workspace-id> <JSON> | handoff add <activity-id> <JSON> | annotate <activity-id> <JSON> | review set <activity-id> <delegation-id> <JSON> | delegate <activity-id> spawn|codex|claude-code <task> | continue <activity-id> spawn|codex|claude-code in-scope:<n> <bounded next step>'
const MAX_INPUT_BYTES = 16_384

type ActivityCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'create'; readonly input: string }
  | { readonly kind: 'open'; readonly id: string }
  | { readonly kind: 'brief'; readonly id: string; readonly revision: number }
  | { readonly kind: 'cancel-assessment' }
  | { readonly kind: 'assess'; readonly id: string; readonly workspaces: readonly [string, string] }
  | { readonly kind: 'delegate'; readonly input: string }
  | { readonly kind: 'continue'; readonly input: string }
  | { readonly kind: 'invalid'; readonly message: string }

/** Parse only the grammar owned by `/activity`. */
function parseCommand(rawInput: string): ActivityCommand {
  if (Buffer.byteLength(rawInput, 'utf8') > MAX_INPUT_BYTES) {
    return { kind: 'invalid', message: `Activity command input must not exceed ${MAX_INPUT_BYTES} bytes. ${USAGE}` }
  }
  const input = rawInput.trim()
  if (input === 'list') return { kind: 'list' }
  const create = /^create\s+([\s\S]+)$/u.exec(input)
  if (create?.[1] !== undefined) return { kind: 'create', input: create[1] }
  const open = /^open\s+(\S+)$/u.exec(input)
  if (open?.[1] !== undefined) return { kind: 'open', id: open[1] }
  const brief = /^brief\s+(\S+)\s+([1-9][0-9]*)$/u.exec(input)
  if (brief?.[1] !== undefined && brief[2] !== undefined) {
    const revision = Number(brief[2])
    if (Number.isSafeInteger(revision)) return { kind: 'brief', id: brief[1], revision }
  }
  if (input === 'assess cancel') return { kind: 'cancel-assessment' }
  const assess = /^assess\s+(\S+)\s+(\S+)\s+(\S+)$/u.exec(input)
  if (assess?.[1] !== undefined && assess[2] !== undefined && assess[3] !== undefined) {
    return { kind: 'assess', id: assess[1], workspaces: [assess[2], assess[3]] }
  }
  const delegate = /^delegate\s+([\s\S]+)$/u.exec(input)
  if (delegate?.[1] !== undefined) return { kind: 'delegate', input: delegate[1] }
  const continuation = /^continue\s+([\s\S]+)$/u.exec(input)
  if (continuation?.[1] !== undefined) return { kind: 'continue', input: continuation[1] }
  return { kind: 'invalid', message: USAGE }
}

/** Register `/activity` against the durable Activity service. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-home-activity'),
    name: 'activity',
    description: 'Create, list, reopen, associate, and explicitly assess saved Activities; record external handoffs, artifact pointers, coordination notes, and outcome reviews; explicitly delegate one DSH-native task or one-shot Codex or Claude Code task, or start a new provider request under the saved objective and a selected in-scope statement',
    input: { hint: 'create <JSON> | list | open <activity-id> | brief <activity-id> <revision> | assess cancel | assess <activity-id> <workspace-id> <workspace-id> | workspaces | sessions | link/unlink <activity-id> workspace|session <context-id> | artifact add <activity-id> <delegation-id> <workspace-id> <JSON> | handoff add <activity-id> <JSON> | annotate <activity-id> <JSON> | review set <activity-id> <delegation-id> <JSON> | delegate <activity-id> spawn|codex|claude-code <task> | continue <activity-id> spawn|codex|claude-code in-scope:<n> <bounded next step>' },
    recordInput: false,
    handler: invocation => execute(ctx, invocation),
  }))
  ctx.effect(() => registerActivityStrategicBriefTool(ctx), 'Activity Strategic Brief recorder')
}

async function execute(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const handoffResult = await executeActivityHandoffCommand(ctx, invocation)
  if (handoffResult !== undefined) return handoffResult
  const annotationResult = await executeActivityAnnotationCommand(ctx, invocation)
  if (annotationResult !== undefined) return annotationResult
  const associationResult = await executeAssociationCommand(ctx, invocation)
  if (associationResult !== undefined) return associationResult
  const reviewResult = await executeActivityReviewCommand(ctx, invocation)
  if (reviewResult !== undefined) return reviewResult
  const command = parseCommand(invocation.rawInput)
  if (command.kind === 'invalid') return { kind: 'error', text: command.message }
  if (command.kind === 'cancel-assessment') return cancelActivityStrategicAssessment(ctx, invocation)
  if (command.kind === 'delegate') return executeActivityDelegation(ctx, invocation, command.input)
  if (command.kind === 'continue') return executeActivityContinuation(ctx, invocation, command.input)
  if (command.kind === 'assess') {
    const parsedId = z.uuid().safeParse(command.id)
    if (!parsedId.success) return { kind: 'error', text: `Activity id must be a UUID. ${USAGE}` }
    const workspaceIds = command.workspaces.map(id => z.uuid().safeParse(id))
    if (workspaceIds.some(result => !result.success)) return { kind: 'error', text: `Workspace ids must be UUIDs. ${USAGE}` }
    return executeActivityStrategicAssessment(
      ctx,
      invocation,
      ActivityId(parsedId.data),
      workspaceIds.map(result => result.data) as [string, string],
    )
  }
  if (command.kind === 'create') {
    let value: unknown
    try {
      value = JSON.parse(command.input)
    } catch {
      return { kind: 'error', text: `Activity details must be valid JSON. ${USAGE}` }
    }
    const parsed = createActivityRequestSchema.safeParse(value)
    if (!parsed.success) {
      return {
        kind: 'error',
        text: `Activity details are invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
      }
    }
    try {
      const activity = await ctx.homeActivities.create(parsed.data)
      return {
        kind: 'success',
        text: `Activity created: ${activity.name}\nID: ${activity.id}\nSaved only; its objective has not been started. Use /activity open ${activity.id} to view its objective and scope.`,
      }
    } catch (error: unknown) {
      if (error instanceof ActivityError) return { kind: 'error', text: error.message }
      if (error instanceof StorageError) {
        ctx.logger.warn('command-home-activity: persistent create failed: %o', error)
        return { kind: 'error', text: 'Activity storage could not confirm the save. Run /activity list before retrying.' }
      }
      ctx.logger.warn('command-home-activity: create failed: %o', error)
      return { kind: 'error', text: 'Activity could not be saved. Run /activity list before retrying.' }
    }
  }

  try {
    if (command.kind === 'list') {
      const activities = ctx.homeActivities.list()
      return {
        kind: 'success',
        text: activities.length === 0
          ? `No saved Activities. ${USAGE}`
          : ['Saved Activities:', ...activities.map(activity => `${activity.name} — ${activity.id}`), '', 'Use /activity open <activity-id> to view saved details.'].join('\n'),
      }
    }
    const parsedId = z.uuid().safeParse(command.id)
    if (!parsedId.success) return { kind: 'error', text: `Activity id must be a UUID. ${USAGE}` }
    const activity = ctx.homeActivities.get(ActivityId(parsedId.data))
    if (activity === undefined) return { kind: 'error', text: `No saved Activity has id ${command.id}.` }
    const strategicEpisodes = ctx.homeActivityStrategicEpisodes.list(activity.id)
    if (command.kind === 'brief') {
      if (!strategicEpisodes.some(episode => episode.revision === command.revision)) {
        return { kind: 'error', text: `Activity ${activity.id} has no saved strategic brief revision ${command.revision}.` }
      }
      return {
        kind: 'success',
        text: [
          `Activity: ${activity.name}`,
          `ID: ${activity.id}`,
          ...renderActivityStrategicEpisodes(strategicEpisodes, activity.id, command.revision),
        ].join('\n'),
      }
    }
    const delegations = ctx.homeActivityDelegations.list(activity.id)
    return {
      kind: 'success',
      text: [
        `Activity: ${activity.name}`,
        `ID: ${activity.id}`,
        `Created: ${activity.createdAt}`,
        `Objective: ${activity.objective}`,
        'Boundaries (descriptive only; runtime permissions are unchanged):',
        ...activity.boundaries.inScope.map((item, index) => `In scope ${index + 1}: ${item}`),
        ...activity.boundaries.outOfScope.map(item => `Out of scope: ${item}`),
        '',
        ...renderActivityAnnotations(ctx, activity.id),
        '',
        ...renderActivityStrategicEpisodes(strategicEpisodes, activity.id),
        '',
        'Delegations:',
        ...(delegations.length === 0
          ? ['No delegation requests.']
          : delegations.flatMap((delegation, index) => [
            ...(index === 0 ? [] : ['']),
            ...renderActivityDelegation(delegation),
            ...renderActivityNextActions(delegation, provider => ctx.subagents.getProvider(provider) !== undefined),
            ...renderActivityReview(ctx, activity.id, delegation.id),
          ])),
        '',
        ...renderActivityHandoffs(ctx, activity.id),
        '',
        ...await renderActivityAssociations(ctx, activity.id),
        '',
        'Opening an Activity displays saved intent and reported facts; it does not start work or activate a Goal.',
      ].join('\n'),
    }
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: read failed: %o', error)
    return { kind: 'error', text: 'Activity or context links could not be read; no current link state was confirmed.' }
  }
}
