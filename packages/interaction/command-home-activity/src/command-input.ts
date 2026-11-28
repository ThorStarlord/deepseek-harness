/** Parse user-provided identifiers and dispatch state for `/activity` subcommands. */
import { z } from 'zod'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

/** Result of parsing a user-provided UUID field.
 * @returns Parsed text when valid; otherwise a command-owned validation message.
 */
export type CommandUuidResult =
  | { readonly success: true; readonly data: string }
  | { readonly success: false; readonly message: string }

/** Result of recognizing and validating a subcommand's Activity identity.
 * @typeParam T - Recognized command fields that include an Activity id.
 */
export type ActivitySubcommandResult<T> =
  | { readonly kind: 'result'; readonly result: CommandResult | undefined }
  | { readonly kind: 'command'; readonly command: T; readonly activityId: string }

/** Result of decoding and validating one JSON payload used by an Activity command. */
export type ActivityJsonInputResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly message: string }

/** Parse a subcommand, return its simple feedback, or validate its Activity UUID.
 * @param rawInput - Raw command input received by the owning handler.
 * @param parse - Command-specific grammar parser.
 * @param usage - Command usage string appended to an invalid UUID message.
 * @returns A command result for unhandled or invalid input, or validated command data.
 */
export function parseActivitySubcommand<T extends { readonly activityId: string }>(
  rawInput: string,
  parse: (rawInput: string) => T | { readonly kind: 'invalid'; readonly message: string } | undefined,
  usage: string,
): ActivitySubcommandResult<T> {
  const parsed = parse(rawInput)
  if (parsed === undefined) return { kind: 'result', result: undefined }
  if (!('activityId' in parsed)) {
    return { kind: 'result', result: { kind: 'error', text: parsed.message } }
  }
  const activityId = commandUuid(parsed.activityId, 'Activity id', usage)
  if (!activityId.success) {
    return { kind: 'result', result: { kind: 'error', text: activityId.message } }
  }
  return { kind: 'command', command: parsed, activityId: activityId.data }
}

/** Validate one UUID field and keep parser diagnostics out of command feedback.
 * @param value - User-provided identifier text.
 * @param label - User-facing identifier label, such as `Delegation id`.
 * @param usage - Command usage string appended to an invalid-field message.
 * @returns The UUID text or a stable usage message.
 */
export function commandUuid(value: string, label: string, usage: string): CommandUuidResult {
  const parsed = z.uuid().safeParse(value)
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, message: `${label} must be a UUID. ${usage}` }
}

/** Parse a command JSON payload and return stable diagnostics without exposing parser internals.
 * @typeParam T - Validated payload type.
 * @param rawInput - JSON text supplied to the owning command.
 * @param label - User-facing payload label.
 * @param usage - Command usage string used for malformed JSON feedback.
 * @param schema - Owning command's payload schema.
 * @returns Validated data, or command-owned feedback for malformed or invalid input.
 */
export function parseActivityJsonInput<T>(
  rawInput: string,
  label: string,
  usage: string,
  schema: z.ZodType<T>,
): ActivityJsonInputResult<T> {
  let input: unknown
  try {
    input = JSON.parse(rawInput)
  } catch (parseError: unknown) {
    void parseError
    return { success: false, message: `${label} details must be valid JSON. ${usage}` }
  }
  const parsed = schema.safeParse(input)
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, message: `${label} details are invalid: ${parsed.error.issues.map(issue => issue.message).join('; ')}` }
}
