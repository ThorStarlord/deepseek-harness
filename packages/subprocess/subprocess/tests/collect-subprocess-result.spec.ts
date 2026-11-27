import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputRead } from '../src/types.ts'
import { collectSubprocessResult } from '../src/collect-subprocess-result.ts'

const outcome: SubprocessOutcome = { exitCode: 0, signal: null }
const stdout: SubprocessOutputRead = { text: 'out', nextOffset: 3, lossy: false }
const stderr: SubprocessOutputRead = { text: 'err', nextOffset: 3, lossy: false }

function createHandle(options: {
  done?: Promise<SubprocessOutcome>
  waitForExit: SubprocessHandle['waitForExit']
  readStdout: (fromByte: number) => SubprocessOutputRead
  readStderr: (fromByte: number) => SubprocessOutputRead
}): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: options.readStdout },
      stderr: { readFrom: options.readStderr },
    },
    done: options.done ?? Promise.resolve(outcome),
    terminate: vi.fn(),
    waitForExit: options.waitForExit,
  }
}

describe('collectSubprocessResult', () => {
  it('waits for command completion and range exit before reading both streams', async () => {
    let resolveDone!: (value: SubprocessOutcome) => void
    const done = new Promise<SubprocessOutcome>((resolve) => { resolveDone = resolve })
    const events: string[] = []
    const waitForExit = vi.fn(async (_signal?: AbortSignal) => { events.push('exit'); return true })
    const readStdout = vi.fn((_fromByte: number) => { events.push('stdout'); return stdout })
    const readStderr = vi.fn((_fromByte: number) => { events.push('stderr'); return stderr })
    const handle = createHandle({ done, waitForExit, readStdout, readStderr })
    const signal = new AbortController().signal
    const resultPromise = collectSubprocessResult(handle, signal)

    expect(waitForExit).not.toHaveBeenCalled()
    resolveDone(outcome)

    await expect(resultPromise).resolves.toEqual({ outcome, stdout, stderr })
    expect(waitForExit).toHaveBeenCalledWith(signal)
    expect(events).toEqual(['exit', 'stdout', 'stderr'])
  })

  it('propagates command and range failures without reading incomplete output', async () => {
    const commandFailure = new Error('command failed')
    const unusedReader = vi.fn((_fromByte: number) => stdout)
    const commandWait = vi.fn(async () => true)
    const failedCommand = createHandle({
      done: Promise.reject(commandFailure),
      waitForExit: commandWait,
      readStdout: unusedReader,
      readStderr: unusedReader,
    })
    await expect(collectSubprocessResult(failedCommand)).rejects.toBe(commandFailure)
    expect(commandWait).not.toHaveBeenCalled()
    expect(unusedReader).not.toHaveBeenCalled()

    const rangeFailure = new Error('range wait failed')
    const rangeWait = vi.fn(async () => { throw rangeFailure })
    const failedRange = createHandle({
      waitForExit: rangeWait,
      readStdout: unusedReader,
      readStderr: unusedReader,
    })
    await expect(collectSubprocessResult(failedRange)).rejects.toBe(rangeFailure)
    expect(unusedReader).not.toHaveBeenCalled()
  })
})
