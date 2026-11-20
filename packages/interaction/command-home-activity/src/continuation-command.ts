/** Explicit continuation requests tied to saved Activity scope. @module @deepseek-ai/dsh-command-home-activity/continuation-command */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import type { Activity } from '@deepseek-ai/dsh-home-activity'
import { z } from 'zod'
import { executeActivityDelegation } from './delegation-command.ts'

const USAGE = 'Usage: /activity continue <activity-id> <provider> in-scope:<1-based-index> <bounded next step>'

/** Run a new, explicitly requested provider task under one saved in-scope Activity statement.
 * @param ctx - Command services.
 * @param invocation - Exact live command owner and request cancellation.
 * @param rawInput - Input following `/activity continue`.
 * @returns The admission or a safe command error.
 */
export async function executeActivityContinuation(
  ctx: Context,
  invocation: CommandInvocation,
  rawInput: string,
): Promise<CommandResult> {
  const match = /^\s*(\S+)\s+(\S+)\s+(in-scope|out-of-scope):(\d+)\s+([\s\S]+)$/u.exec(rawInput)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined || match[5] === undefined) {
    return { kind: 'error', text: USAGE }
  }
  const activityId = z.uuid().safeParse(match[1])
  if (!activityId.success) return { kind: 'error', text: `Activity id must be a UUID. ${USAGE}` }
  const requestedStep = match[5]
  if (requestedStep.trim().length === 0) return { kind: 'error', text: `A bounded next step is required. ${USAGE}` }

  let activity: Activity | undefined
  try {
    activity = ctx.homeActivities.get(ActivityId(activityId.data))
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: continuation lookup failed: %o', error)
    return { kind: 'error', text: 'Activity state could not be confirmed; no provider call was attempted.' }
  }
  if (activity === undefined) return { kind: 'error', text: `No saved Activity has id ${match[1]}.` }
  if (match[3] === 'out-of-scope') {
    return { kind: 'error', text: 'An out-of-scope statement cannot be continued. Select an existing in-scope statement or create a separate Activity for another objective.' }
  }
  const scopeIndex = Number(match[4])
  const selectedScope = Number.isSafeInteger(scopeIndex) && scopeIndex > 0
    ? activity.boundaries.inScope[scopeIndex - 1]
    : undefined
  if (selectedScope === undefined) {
    return {
      kind: 'error',
      text: `Choose an existing in-scope statement numbered 1–${activity.boundaries.inScope.length}; run /activity open ${activity.id} to see the numbered statements. A new objective needs a separate Activity. ${USAGE}`,
    }
  }

  const providerTask = [
    `Continue the saved Activity objective: ${JSON.stringify(activity.objective)}`,
    `Selected in-scope statement ${scopeIndex}: ${JSON.stringify(selectedScope)}`,
    `User-requested bounded next step: ${JSON.stringify(requestedStep)}`,
    'Do not start an unrelated objective. If the requested step needs a different objective, stop and ask the user.',
    'Activity scope is descriptive context; it does not grant or restrict the provider’s native permissions or DSH runtime policy.',
  ].join('\n')
  const result = await executeActivityDelegation(ctx, invocation, `${activity.id} ${match[2]} ${providerTask}`)
  if (result.kind === 'error') return result
  return {
    ...result,
    text: `This is a new explicit provider request, not a resume of prior execution. ${result.text ?? ''}`.trim(),
  }
}
