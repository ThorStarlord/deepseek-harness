/** Shared size and ownership checks for /activity subcommands. @module @deepseek-ai/dsh-command-home-activity/bounded-subcommand-input */

/** Input recognized as one bounded Activity subcommand. */
export type BoundedSubcommandInput =
  | { readonly kind: 'input'; readonly input: string }
  | { readonly kind: 'invalid'; readonly message: string }

/** Recognize a subcommand without intercepting another Activity verb.
 * @param rawInput - User-supplied text following `/activity`.
 * @param verb - Lowercase subcommand owned by the caller.
 * @param maxBytes - Maximum UTF-8 size accepted by that subcommand.
 * @param overLimitMessage - Safe command-specific error shown for oversized input.
 * @returns The trimmed input or its size error, or `undefined` for another verb.
 */
export function boundedSubcommandInput(
  rawInput: string,
  verb: string,
  maxBytes: number,
  overLimitMessage: string,
): BoundedSubcommandInput | undefined {
  const input = rawInput.trim()
  const owned = input === verb || input.startsWith(verb) && /^\s/u.test(input.slice(verb.length))
  if (!owned) return undefined
  if (Buffer.byteLength(rawInput, 'utf8') > maxBytes) return { kind: 'invalid', message: overLimitMessage }
  return { kind: 'input', input }
}
