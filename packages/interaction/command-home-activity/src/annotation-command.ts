/** User commands for appending Activity annotation revisions and showing their history.
 * @module @deepseek-ai/dsh-command-home-activity/annotation-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import { ActivityAnnotationError, ActivityAnnotationStorageError } from '@deepseek-ai/dsh-home-activity/annotations'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

const USAGE = 'Usage: /activity annotate <activity-id> <JSON> where JSON is {"text":"..."}'
const MAX_INPUT_BYTES = 16_384
const MAX_RENDERED_REVISIONS = 8
const annotationInputSchema = z.object({ text: z.string() }).strict()

type ParsedCommand =
  | { readonly kind: 'annotate'; readonly activityId: string; readonly input: string }
  | { readonly kind: 'invalid'; readonly message: string }

/** Execute an annotation correction owned by the existing `/activity` command.
 * @param ctx - Cordis context providing the annotation persistence service.
 * @param invocation - Direct human command input.
 * @returns Command feedback, or `undefined` when another Activity command owns the input.
 */
export async function executeActivityAnnotationCommand(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult | undefined> {
  const parsed = parse(invocation.rawInput)
  if (parsed === undefined) return undefined
  if (parsed.kind === 'invalid') return { kind: 'error', text: parsed.message }
  const activityId = z.uuid().safeParse(parsed.activityId)
  if (!activityId.success) return { kind: 'error', text: `Activity id must be a UUID. ${USAGE}` }

  let input: unknown
  try {
    input = JSON.parse(parsed.input)
  } catch {
    return { kind: 'error', text: `Activity annotation must be valid JSON. ${USAGE}` }
  }
  const note = annotationInputSchema.safeParse(input)
  if (!note.success) {
    return { kind: 'error', text: `Activity annotation is invalid: ${note.error.issues.map(issue => issue.message).join('; ')}. ${USAGE}` }
  }

  try {
    const saved = await ctx.homeActivityAnnotations.correct({ activityId: ActivityId(activityId.data), text: note.data.text })
    return {
      kind: 'success',
      text: [
        `User annotation revision ${saved.revision} recorded for Activity ${saved.activityId}.`,
        `Current annotation: ${saved.text}`,
        saved.supersedes === undefined ? 'This starts the annotation history.' : 'Earlier user annotations remain in history.',
        'Provider-reported and specialist-authored facts were not changed.',
      ].join('\n'),
    }
  } catch (error: unknown) {
    if (error instanceof ActivityAnnotationError) {
      const recovery = error.code === 'unknown-activity'
        ? 'Run /activity list to choose a saved Activity id.'
        : error.code === 'annotation-limit'
          ? `Run /activity open ${activityId.data} to inspect the saved annotation history.`
          : `Check the note text and retry. ${USAGE}`
      return { kind: 'error', text: `${error.message} ${recovery}` }
    }
    if (error instanceof ActivityAnnotationStorageError || error instanceof StorageError) {
      ctx.logger.warn('command-home-activity: annotation persistence failed: %o', error)
      return { kind: 'error', text: `Activity annotation storage failed; no correction was confirmed. Run /activity open ${activityId.data} before retrying.` }
    }
    ctx.logger.warn('command-home-activity: annotation could not be recorded: %o', error)
    return { kind: 'error', text: 'The Activity could not be confirmed; no annotation was recorded.' }
  }
}

/** Render immutable annotation history without merging it with provider or specialist facts.
 * @param ctx - Cordis context providing the annotation persistence service.
 * @param activityId - Stable Activity identity.
 * @returns The current user annotation and its attributed revision history.
 */
export function renderActivityAnnotations(ctx: Context, activityId: ReturnType<typeof ActivityId>): readonly string[] {
  let annotations: ReturnType<Context['homeActivityAnnotations']['list']>
  try {
    annotations = ctx.homeActivityAnnotations.list(activityId)
  } catch (error: unknown) {
    ctx.logger.warn('command-home-activity: annotation history read failed: %o', error)
    return Object.freeze(['User annotations could not be read; no current note was confirmed.'])
  }
  if (annotations.length === 0) {
    return Object.freeze([
      'Home Harness coordination annotation (user-authored; separate from provider reports and specialist assertions):',
      'No annotation recorded. Use /activity annotate <activity-id> <JSON> to add a note.',
    ])
  }
  const current = annotations.at(-1)
  if (current === undefined) {
    return Object.freeze(['User annotation history could not be read; no current note was confirmed.'])
  }
  const visibleAnnotations = annotations.slice(-MAX_RENDERED_REVISIONS)
  const olderRevisionCount = annotations.length - visibleAnnotations.length
  return Object.freeze([
    'Home Harness coordination annotations (user-authored history; separate from provider reports and specialist assertions):',
    `Current annotation (revision ${current.revision}): ${current.text}`,
    'Annotation history:',
    ...(olderRevisionCount === 0
      ? []
      : [`${olderRevisionCount} earlier revisions are saved; this view shows the latest ${MAX_RENDERED_REVISIONS}.`]),
    ...visibleAnnotations.map(annotation => [
      `Revision ${annotation.revision} (${annotation.recordedAt}; source: ${annotation.source})${annotation.supersedes === undefined ? '' : `; supersedes ${annotation.supersedes}`}:`,
      annotation.text,
    ]).flat(),
  ])
}

function parse(rawInput: string): ParsedCommand | undefined {
  if (Buffer.byteLength(rawInput, 'utf8') > MAX_INPUT_BYTES) {
    return /^annotate(?:\s|$)/u.test(rawInput.trim())
      ? { kind: 'invalid', message: `Activity annotation input must not exceed ${MAX_INPUT_BYTES} bytes. ${USAGE}` }
      : undefined
  }
  const input = rawInput.trim()
  if (!/^annotate(?:\s|$)/u.test(input)) return undefined
  const match = /^annotate\s+(\S+)\s+([\s\S]+)$/u.exec(input)
  return match?.[1] === undefined || match[2] === undefined
    ? { kind: 'invalid', message: USAGE }
    : { kind: 'annotate', activityId: match[1], input: match[2] }
}
