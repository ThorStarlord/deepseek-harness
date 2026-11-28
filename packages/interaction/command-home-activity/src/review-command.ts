/** User commands and Activity rendering for separately recorded outcome reviews.
 * @module @deepseek-ai/dsh-command-home-activity/review-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { ActivityReviewError, ActivityReviewStorageError } from '@deepseek-ai/dsh-home-activity/reviews'
import { activityDelegationId } from '@deepseek-ai/dsh-home-activity/delegations'
import type { ActivityDelegationId } from '@deepseek-ai/dsh-home-activity/delegations'
import type { ActivityReviewDisposition, RecordActivityReviewRequest } from '@deepseek-ai/dsh-home-activity/reviews'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { boundedSubcommandInput } from './bounded-subcommand-input.ts'
import { parseActivitySubcommand, parseActivityJsonInput, commandUuid } from './command-input.ts'

const USAGE = 'Usage: /activity review set <activity-id> <delegation-id> <JSON>'
const MAX_INPUT_BYTES = 16_384
const safeText = z.string().trim().min(1).regex(/^[^\p{Cc}]+$/u)
const reviewInputSchema = z.object({
  disposition: z.enum(['pending', 'accepted', 'declined', 'requires-investigation']),
  evidence: z.object({
    source: safeText.max(128),
    result: z.enum(['passed', 'failed', 'inconclusive', 'unavailable']),
    summary: safeText.max(1_024),
    reference: safeText.max(2_048).optional(),
    observedAt: z.iso.datetime().optional(),
  }).strict().optional(),
}).strict()

const REVIEW_RECOVERY: Readonly<Record<ActivityReviewError['code'], (activityId: string) => string>> = {
  'unknown-activity': () => 'Run /activity list to choose a saved Activity id.',
  'unknown-delegation': activityId => `Run /activity open ${activityId} to choose a saved delegation id.`,
  'delegation-activity-mismatch': () => 'Choose a delegation recorded for this Activity.',
  'provider-report-unavailable': activityId => `Run /activity open ${activityId} after its provider report is recorded, then retry the review.`,
  'evidence-limit': activityId => `Inspect saved review evidence with /activity open ${activityId}.`,
}

type ParsedReviewCommand =
  | { readonly kind: 'set'; readonly activityId: string; readonly delegationId: string; readonly input: string }
  | { readonly kind: 'invalid'; readonly message: string }

/**
 * Execute `/activity review` commands and leave other command families untouched.
 * @param ctx - Services for review persistence and Activity ownership checks.
 * @param invocation - Explicit human command invocation.
 * @returns The command result when the command belongs to this handler, otherwise `undefined`.
 */
export async function executeActivityReviewCommand(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult | undefined> {
  const command = parseActivitySubcommand(invocation.rawInput, parse, USAGE)
  if (command.kind === 'result') return command.result
  const parsed = command.command
  const activityId = command.activityId
  const delegationId = commandUuid(parsed.delegationId, 'Delegation id', USAGE)
  if (!delegationId.success) return { kind: 'error', text: delegationId.message }

  const details = parseActivityJsonInput(parsed.input, 'Review', USAGE, reviewInputSchema)
  if (!details.success) return { kind: 'error', text: details.message }

  const request: RecordActivityReviewRequest = {
    activityId: ActivityId(activityId),
    delegationId: activityDelegationId(delegationId.data),
    disposition: details.data.disposition,
    ...(details.data.evidence === undefined ? {} : { evidence: details.data.evidence }),
  }
  try {
    const review = await ctx.homeActivityReviews.record(request)
    return {
      kind: 'success',
      text: [
        `User disposition recorded: ${dispositionLabel(review.disposition)}.`,
        details.data.evidence === undefined
          ? review.evidence.length === 0
            ? 'No verification evidence is currently recorded.'
            : 'No new verification evidence was supplied; previously recorded evidence was retained.'
          : `User-supplied evidence recorded: ${details.data.evidence.source} reports ${details.data.evidence.result}. DSH did not verify its source or result.`,
        'The provider execution report was not changed.',
      ].join('\n'),
    }
  } catch (error: unknown) {
    if (error instanceof ActivityReviewError) {
      const recovery = REVIEW_RECOVERY[error.code](activityId)
      return { kind: 'error', text: `${error.message} ${recovery}` }
    }
    if (error instanceof ActivityReviewStorageError) {
      ctx.logger.warn('command-home-activity: review persistence failed: %o', error)
      return { kind: 'error', text: `Activity review storage failed; no updated review was confirmed. Run /activity open ${activityId} before retrying.` }
    }
    ctx.logger.warn('command-home-activity: review could not be recorded: %o', error)
    return { kind: 'error', text: 'The selected Activity and delegation could not be confirmed; no updated review was recorded.' }
  }
}

/**
 * Render one delegation's user disposition and evidence without changing its provider report.
 * @param ctx - Services for reading review state.
 * @param activityId - Stable Activity identity.
 * @param delegationId - Delegation identity selected for display.
 * @returns User disposition and separately attributed evidence lines.
 */
export function renderActivityReview(
  ctx: Context,
  activityId: ReturnType<typeof ActivityId>,
  delegationId: ActivityDelegationId,
): readonly string[] {
  let review
  try {
    review = ctx.homeActivityReviews.get(activityId, delegationId)
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: review read failed: %o', error)
    return Object.freeze(['User review state could not be read; no current disposition or evidence was confirmed.'])
  }
  if (review === undefined) {
    return Object.freeze([
      'User disposition: pending; no review has been recorded.',
      'Verification evidence: none recorded.',
    ])
  }
  const lines = [
    `User disposition: ${dispositionLabel(review.disposition)} (recorded ${review.updatedAt}).`,
    review.evidence.length === 0
      ? 'Verification evidence: none recorded.'
      : 'User-supplied verification evidence (not checked by DSH):',
  ]
  for (const [index, evidence] of review.evidence.entries()) {
    lines.push(`Evidence ${index + 1}: ${evidence.source} reports ${evidence.result}.`)
    lines.push(`Evidence summary: ${evidence.summary}`)
    if (evidence.reference !== undefined) lines.push(`Evidence reference: ${evidence.reference}`)
    if (evidence.observedAt !== undefined) lines.push(`Evidence observed: ${evidence.observedAt}`)
    lines.push(`Evidence recorded: ${evidence.recordedAt}; source entered by user command.`)
  }
  lines.push('This user disposition and evidence do not alter the provider report.')
  return Object.freeze(lines)
}

function parse(rawInput: string): ParsedReviewCommand | undefined {
  const bounded = boundedSubcommandInput(
    rawInput,
    'review',
    MAX_INPUT_BYTES,
    `Activity review input must not exceed ${MAX_INPUT_BYTES} bytes. ${USAGE}`,
  )
  if (bounded === undefined) return undefined
  if (bounded.kind === 'invalid') return { kind: 'invalid', message: bounded.message }
  const match = /^review\s+set\s+(\S+)\s+(\S+)\s+([\s\S]+)$/u.exec(bounded.input)
  return match?.[1] === undefined || match[2] === undefined || match[3] === undefined
    ? { kind: 'invalid', message: USAGE }
    : { kind: 'set', activityId: match[1], delegationId: match[2], input: match[3] }
}

function dispositionLabel(value: ActivityReviewDisposition): string {
  return value === 'requires-investigation' ? 'requires investigation' : value
}
