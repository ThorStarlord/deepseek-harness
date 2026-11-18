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
import { executeActivityDelegation, renderActivityDelegation } from './delegation-command.ts'
import { executeAssociationCommand, renderActivityAssociations } from './association-command.ts'
import { executeActivityReviewCommand, renderActivityReview } from './review-command.ts'

export const name = 'command-home-activity'
export const inject = [
  'commands',
  'homeActivities',
  'homeActivityDelegations',
  'subagents',
  'homeActivityAssociations',
  'homeActivityArtifacts',
  'homeActivityReviews',
  'workspaceRegistry',
  'sessionPersistence',
]

const USAGE = 'Usage: /activity create <JSON> | list | open <activity-id> | workspaces | sessions | link/unlink <activity-id> workspace|session <context-id> | artifact add <activity-id> <delegation-id> <workspace-id> <JSON> | review set <activity-id> <delegation-id> <JSON> | delegate <activity-id> spawn|codex <task>'
const MAX_INPUT_BYTES = 16_384

type ActivityCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'create'; readonly input: string }
  | { readonly kind: 'open'; readonly id: string }
  | { readonly kind: 'delegate'; readonly input: string }
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
  const delegate = /^delegate\s+([\s\S]+)$/u.exec(input)
  if (delegate?.[1] !== undefined) return { kind: 'delegate', input: delegate[1] }
  return { kind: 'invalid', message: USAGE }
}

/** Register `/activity` against the durable Activity service. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-home-activity'),
    name: 'activity',
    description: 'Create, list, reopen, associate Activities, record artifact pointers and outcome reviews, or explicitly delegate one DSH-native task or one-shot Codex task',
    input: { hint: 'create <JSON> | list | open <activity-id> | workspaces | sessions | link/unlink <activity-id> workspace|session <context-id> | artifact add <activity-id> <delegation-id> <workspace-id> <JSON> | review set <activity-id> <delegation-id> <JSON> | delegate <activity-id> spawn|codex <task>' },
    recordInput: false,
    handler: invocation => execute(ctx, invocation),
  }))
}

async function execute(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const associationResult = await executeAssociationCommand(ctx, invocation)
  if (associationResult !== undefined) return associationResult
  const reviewResult = await executeActivityReviewCommand(ctx, invocation)
  if (reviewResult !== undefined) return reviewResult
  const command = parseCommand(invocation.rawInput)
  if (command.kind === 'invalid') return { kind: 'error', text: command.message }
  if (command.kind === 'delegate') return executeActivityDelegation(ctx, invocation, command.input)
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
    const delegations = ctx.homeActivityDelegations.list(activity.id)
    return {
      kind: 'success',
      text: [
        `Activity: ${activity.name}`,
        `ID: ${activity.id}`,
        `Created: ${activity.createdAt}`,
        `Objective: ${activity.objective}`,
        'Boundaries (descriptive only; runtime permissions are unchanged):',
        ...activity.boundaries.inScope.map(item => `In scope: ${item}`),
        ...activity.boundaries.outOfScope.map(item => `Out of scope: ${item}`),
        '',
        'Delegations:',
        ...(delegations.length === 0
          ? ['No delegation requests.']
          : delegations.flatMap((delegation, index) => [
            ...(index === 0 ? [] : ['']),
            ...renderActivityDelegation(delegation),
            ...renderActivityReview(ctx, activity.id, delegation.id),
          ])),
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
