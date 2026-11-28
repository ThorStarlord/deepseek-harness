/** Human command and rendering for user-supplied external Activity handoffs.
 * @module @deepseek-ai/dsh-command-home-activity/handoff-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { StorageError } from '@deepseek-ai/dsh-storage'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import {
  ActivityHandoffError,
  ActivityHandoffStorageError,
  createActivityHandoffDetailsSchema,
} from '@deepseek-ai/dsh-home-activity/handoffs'
import type { ActivityHandoff } from '@deepseek-ai/dsh-home-activity/handoffs'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { boundedSubcommandInput } from './bounded-subcommand-input.ts'
import { parseActivitySubcommand } from './command-input.ts'

const USAGE = 'Usage: /activity handoff add <activity-id> <JSON>'
const MAX_INPUT_BYTES = 16_384

type ParsedCommand =
  | { readonly kind: 'add'; readonly activityId: string; readonly details: string }
  | { readonly kind: 'invalid'; readonly message: string }

/** Execute the `/activity handoff` commands or leave another Activity verb to its owner.
 * @param ctx - Plugin context for Activity handoff persistence.
 * @param invocation - Human command invocation and its DSH Agent identity.
 * @returns The command result, or `undefined` when another command owns the input.
 */
export async function executeActivityHandoffCommand(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult | undefined> {
  const command = parseActivitySubcommand(invocation.rawInput, parse, USAGE)
  if (command.kind === 'result') return command.result
  const parsed = command.command
  const activityId = command.activityId

  let rawDetails: unknown
  try {
    rawDetails = JSON.parse(parsed.details)
  } catch {
    return { kind: 'error', text: `External handoff details must be valid JSON. ${USAGE}` }
  }
  const details = createActivityHandoffDetailsSchema.safeParse(rawDetails)
  if (!details.success) {
    return { kind: 'error', text: `External handoff details are invalid: ${details.error.issues.map(issue => issue.message).join('; ')} ${USAGE}` }
  }

  try {
    const handoff = await ctx.homeActivityHandoffs.create({
      activityId: ActivityId(activityId),
      ...details.data,
      recordedInSessionId: invocation.agent.id,
    })
    return { kind: 'success', text: renderCreatedHandoff(handoff) }
  } catch (error: unknown) {
    if (error instanceof ActivityHandoffError) {
      const recovery = error.code === 'unknown-activity'
        ? 'Run /activity list to choose a saved Activity id.'
        : error.code === 'handoff-limit'
          ? `Run /activity open ${activityId} to inspect recorded handoffs.`
          : `Check the source, summary, and artifact references. ${USAGE}`
      return { kind: 'error', text: `${error.message} ${recovery}` }
    }
    if (error instanceof ActivityHandoffStorageError || error instanceof StorageError) {
      ctx.logger.warn('command-home-activity: external handoff persistence failed: %o', error)
      return { kind: 'error', text: `External handoff storage could not confirm the record. Run /activity open ${activityId} before retrying.` }
    }
    ctx.logger.warn('command-home-activity: external handoff could not be recorded: %o', error)
    return { kind: 'error', text: 'The selected Activity or handoff details could not be confirmed; no record was confirmed.' }
  }
}

/** Render saved handoffs without implying imported execution, verification, or acceptance.
 * @param ctx - Plugin context for durable Activity handoff reads.
 * @param activityId - Stable identity of the Activity being opened.
 * @returns Lines identifying saved user-supplied reports and their references.
 */
export function renderActivityHandoffs(ctx: Context, activityId: ReturnType<typeof ActivityId>): readonly string[] {
  let handoffs: readonly ActivityHandoff[]
  try {
    handoffs = ctx.homeActivityHandoffs.list(activityId)
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: external handoff catalog read failed: %o', error)
    return Object.freeze(['External handoffs could not be read; no current handoff state was confirmed.'])
  }
  const lines = ['External handoffs (user-supplied; not imported native execution history):']
  if (handoffs.length === 0) {
    lines.push('No external handoffs have been recorded.')
    return Object.freeze(lines)
  }
  for (const handoff of handoffs) {
    lines.push(`External handoff: ${handoff.source} — ${handoff.id}`)
    lines.push(`Recorded in DSH Session: ${handoff.recordedInSessionId}`)
    if (handoff.summary !== undefined) lines.push(`User-supplied summary: ${handoff.summary}`)
    if (handoff.sourceReference !== undefined) lines.push(`User-supplied source reference: ${handoff.sourceReference}`)
    for (const artifact of handoff.artifacts) {
      lines.push(`User-supplied artifact reference: ${artifact.label} — ${artifact.location}`)
      lines.push(`Artifact revision: ${artifact.revision ?? 'unknown'}`)
    }
    lines.push('This external report was not imported as a native Session and has not been independently verified or accepted.')
  }
  return Object.freeze(lines)
}

function renderCreatedHandoff(handoff: ActivityHandoff): string {
  return [
    `External handoff recorded: ${handoff.source}`,
    `ID: ${handoff.id}`,
    `Activity: ${handoff.activityId}`,
    'Origin: user-supplied external report',
    `Recorded in DSH Session: ${handoff.recordedInSessionId}`,
    ...(handoff.summary === undefined ? [] : [`User-supplied summary: ${handoff.summary}`]),
    ...(handoff.sourceReference === undefined ? [] : [`User-supplied source reference: ${handoff.sourceReference}`]),
    ...handoff.artifacts.flatMap(artifact => [
      `User-supplied artifact reference: ${artifact.label} — ${artifact.location}`,
      `Artifact revision: ${artifact.revision ?? 'unknown'}`,
    ]),
    'This record does not import a native Session or confirm external execution, verification, or acceptance.',
  ].join('\n')
}

function parse(rawInput: string): ParsedCommand | undefined {
  const bounded = boundedSubcommandInput(
    rawInput,
    'handoff',
    MAX_INPUT_BYTES,
    `External handoff command input must not exceed ${MAX_INPUT_BYTES} bytes. ${USAGE}`,
  )
  if (bounded === undefined) return undefined
  if (bounded.kind === 'invalid') return { kind: 'invalid', message: bounded.message }
  const match = /^handoff\s+add\s+(\S+)\s+([\s\S]+)$/u.exec(bounded.input)
  return match?.[1] === undefined || match[2] === undefined
    ? { kind: 'invalid', message: USAGE }
    : { kind: 'add', activityId: match[1], details: match[2] }
}
