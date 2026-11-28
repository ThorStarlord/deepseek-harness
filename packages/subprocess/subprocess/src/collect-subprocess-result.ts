/**
 * Read a collected subprocess result after its managed process range exits.
 * @module @deepseek-ai/dsh-subprocess/collect-subprocess-result
 */

import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputRead } from './types.ts'

/** Collected process facts available after the managed process range exits. */
export interface CollectedSubprocessResult {
  /** Exit facts reported by the spawned command. */
  outcome: SubprocessOutcome
  /** Collected standard output, when the spawn requested it. */
  stdout?: SubprocessOutputRead
  /** Collected standard error, when the spawn requested it. */
  stderr?: SubprocessOutputRead
}

/**
 * Wait for command completion and managed-range quiescence before reading collected output. A
 * canceled wait rejects without returning partial output.
 * Rejections from `done` or `waitForExit` propagate unchanged; callers retain ownership of
 * exit-code interpretation, lossy-output handling, and user-facing errors.
 * A false wait result throws the signal reason when aborted, or an error if no abort explains it.
 * @param handle - managed subprocess whose collected streams should be read.
 * @param signal - optional cancellation signal for waiting on the managed range.
 * @returns command exit facts and available collected output from offset zero.
 */
export async function collectSubprocessResult(
  handle: SubprocessHandle,
  signal?: AbortSignal,
): Promise<CollectedSubprocessResult> {
  const outcome = await handle.done
  const rangeExited = await handle.waitForExit(signal)
  if (!rangeExited) {
    signal?.throwIfAborted()
    throw new Error('Managed subprocess range did not become quiescent before collected output was read')
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  return {
    outcome,
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
  }
}
