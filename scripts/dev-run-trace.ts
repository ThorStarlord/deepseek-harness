/** Record and report local development operation timing without command contents. */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { execa } from 'execa'
import { performance } from 'node:perf_hooks'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const FORMAT_VERSION = 1
const DEFAULT_TRACE_ROOT = '.artifacts/dev-run-traces'
const ACTIVITIES = ['implementation', 'build', 'test', 'lint', 'documentation', 'demonstration', 'review', 'integration', 'wait', 'other'] as const

type Activity = typeof ACTIVITIES[number]
type OperationStatus = 'succeeded' | 'failed' | 'spawn-failed' | 'signaled' | 'completed' | 'unknown'
type ProcessStatus = 'succeeded' | 'failed' | 'spawn-failed' | 'signaled'
type SpanStatus = 'completed' | 'failed' | 'unknown'

type RunEvent = {
  version: typeof FORMAT_VERSION
  timestamp: string
  processId: number
  runId: string
  parentRunId?: string
  taskId: string
  agentId: string
} & (
  | { event: 'run-started' }
  | { event: 'run-finished' }
)

type OperationEvent = {
  version: typeof FORMAT_VERSION
  timestamp: string
  processId: number
  runId: string
  operationId: string
  taskId: string
  agentId: string
  activity: Activity
  dependsOn: string[]
} & (
  | { event: 'operation-started'; monotonicMs: number }
  | { event: 'operation-finished'; durationMs: number; status: ProcessStatus; failureCode?: string; exitCode?: number | null; signal?: string | null }
  | { event: 'span-started' }
  | { event: 'span-finished'; status: SpanStatus }
)

type TraceEvent = RunEvent | OperationEvent

interface RunSummary {
  runId: string
  taskId: string
  agentId: string
  parentRunId?: string
  startedAt?: string
  startedProcessId?: number
  finishedAt?: string
  finishedProcessId?: number
  durationMs?: number
  status: 'complete' | 'incomplete' | 'clock-reversed'
}

interface OperationSummary {
  runId: string
  operationId: string
  taskId: string
  agentId: string
  activity: Activity
  dependsOn: string[]
  startedAt?: string
  startedProcessId?: number
  finishedAt?: string
  finishedProcessId?: number
  startObserved: boolean
  finishObserved: boolean
  wallInterval: 'forward' | 'reversed' | 'unknown'
  durationMs?: number
  durationBasis: 'monotonic' | 'wall' | 'unknown'
  status: OperationStatus | 'incomplete'
  failureCode?: string
  exitCode?: number | null
  signal?: string | null
}

interface TraceSummary {
  run: RunSummary | undefined
  childRuns: RunSummary[]
  operations: OperationSummary[]
  activityDurationMs: Map<Activity, number>
  completedOperationDurationMs: number
  operationWallUnionMs: number
  concurrentOperationWallMs: number
  subagentWallUnionMs: number
  concurrentSubagentWallMs: number
  completeSubagentIntervalCount: number
  incompleteSubagentIntervalCount: number
  observedWallUnionMs: number
  unattributedWallMs?: number
  dependencyEdges: Array<{
    predecessor: string
    successor: string
    timing: 'precedes' | 'overlaps' | 'unknown' | 'missing' | 'ambiguous'
  }>
  repeatedOperations: Map<string, string[]>
}

interface CliOptions {
  trace: string
  runId: string
  parentRunId?: string
  taskId: string
  agentId: string
  operationId?: string
  activity?: Activity
  spanStatus?: SpanStatus
  dependsOn: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,47}$/.test(value)
    && !/^sk[-_]/iu.test(value) && !/[A-Za-z0-9]{32,}/u.test(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.includes('T')
}

function isActivity(value: unknown): value is Activity {
  return typeof value === 'string' && ACTIVITIES.includes(value as Activity)
}

function isTraceEvent(value: unknown): value is TraceEvent {
  if (!isRecord(value) || value.version !== FORMAT_VERSION || !isIsoTimestamp(value.timestamp) || !isIdentifier(value.runId)
    || typeof value.processId !== 'number' || !Number.isSafeInteger(value.processId) || value.processId < 1) return false
  if (value.event === 'run-started' || value.event === 'run-finished') {
    return isIdentifier(value.taskId) && isIdentifier(value.agentId)
      && (value.parentRunId === undefined || isIdentifier(value.parentRunId))
  }
  if (value.event === 'operation-started' || value.event === 'operation-finished'
    || value.event === 'span-started' || value.event === 'span-finished') {
    if (!isIdentifier(value.operationId) || !isIdentifier(value.taskId) || !isIdentifier(value.agentId)
      || !isActivity(value.activity) || !Array.isArray(value.dependsOn) || !value.dependsOn.every(isIdentifier)) return false
    if (value.event === 'operation-started') return typeof value.monotonicMs === 'number' && Number.isFinite(value.monotonicMs)
    if (value.event === 'span-started') return true
    if (value.event === 'span-finished') return value.status === 'completed' || value.status === 'failed' || value.status === 'unknown'
    return typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0
      && (value.status === 'succeeded' || value.status === 'failed' || value.status === 'spawn-failed' || value.status === 'signaled')
      && (value.failureCode === undefined || (typeof value.failureCode === 'string' && /^[A-Z0-9_]{2,48}$/u.test(value.failureCode)))
  }
  return false
}

/** Parse allow-listed trace metadata and discard every unknown input field.
 * @param input - The local JSONL trace text.
 * @returns Validated events containing only the supported metadata fields.
 */
export function parseTraceEvents(input: string): TraceEvent[] {
  const events: TraceEvent[] = []
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error(`Trace line ${index + 1} is not valid JSON`)
    }
    if (!isTraceEvent(value)) throw new Error(`Trace line ${index + 1} does not match format version ${FORMAT_VERSION}`)
    switch (value.event) {
      case 'run-started':
        events.push({
          ...traceCommonFields(value),
          event: 'run-started',
          ...(value.parentRunId === undefined ? {} : { parentRunId: value.parentRunId }),
        })
        break
      case 'run-finished':
        events.push({
          ...traceCommonFields(value),
          event: 'run-finished',
          ...(value.parentRunId === undefined ? {} : { parentRunId: value.parentRunId }),
        })
        break
      case 'operation-started':
        events.push({
          ...traceCommonFields(value),
          ...operationCommonFields(value),
          event: 'operation-started',
          monotonicMs: value.monotonicMs,
        })
        break
      case 'span-started':
        events.push({
          ...traceCommonFields(value),
          ...operationCommonFields(value),
          event: 'span-started',
        })
        break
      case 'operation-finished':
        events.push({
          ...traceCommonFields(value),
          ...operationCommonFields(value),
          event: 'operation-finished',
          durationMs: value.durationMs,
          status: value.status,
          ...(value.failureCode === undefined ? {} : { failureCode: value.failureCode }),
          ...(typeof value.exitCode === 'number' || value.exitCode === null ? { exitCode: value.exitCode } : {}),
          ...(typeof value.signal === 'string' || value.signal === null ? { signal: value.signal } : {}),
        })
        break
      case 'span-finished':
        events.push({
          ...traceCommonFields(value),
          ...operationCommonFields(value),
          event: 'span-finished',
          status: value.status,
        })
        break
    }
  }
  assertEventPairs(events)
  return events
}

function traceCommonFields(value: TraceEvent): Pick<RunEvent, 'version' | 'timestamp' | 'processId' | 'runId' | 'taskId' | 'agentId'> {
  return {
    version: FORMAT_VERSION,
    timestamp: value.timestamp,
    processId: value.processId,
    runId: value.runId,
    taskId: value.taskId,
    agentId: value.agentId,
  }
}

function operationCommonFields(value: OperationEvent) {
  return {
    operationId: value.operationId,
    activity: value.activity,
    dependsOn: [...value.dependsOn],
  }
}

function assertEventPairs(events: TraceEvent[]): void {
  const runs = new Map<string, {
    started?: Extract<RunEvent, { event: 'run-started' }>
    finished?: Extract<RunEvent, { event: 'run-finished' }>
  }>()
  const operations = new Map<string, {
    started?: Extract<OperationEvent, { event: 'operation-started' | 'span-started' }>
    finished?: Extract<OperationEvent, { event: 'operation-finished' | 'span-finished' }>
  }>()
  for (const event of events) {
    if (event.event === 'run-started' || event.event === 'run-finished') {
      const pair = runs.get(event.runId) ?? {}
      if (event.event === 'run-started') {
        if (pair.started !== undefined) throw new Error(`Run ${event.runId} has duplicate ${event.event} events`)
        pair.started = event
      } else {
        if (pair.finished !== undefined) throw new Error(`Run ${event.runId} has duplicate ${event.event} events`)
        pair.finished = event
      }
      runs.set(event.runId, pair)
      continue
    }
    const operationKey = `${event.runId}/${event.operationId}`
    const pair = operations.get(operationKey) ?? {}
    if (event.event === 'operation-started' || event.event === 'span-started') {
      if (pair.started !== undefined) throw new Error(`Operation ${event.operationId} has duplicate ${event.event} events`)
      pair.started = event
    } else {
      if (pair.finished !== undefined) throw new Error(`Operation ${event.operationId} has duplicate ${event.event} events`)
      pair.finished = event
    }
    operations.set(operationKey, pair)
  }
  for (const [operationKey, pair] of operations) {
    if (pair.started === undefined || pair.finished === undefined) continue
    const startedAsCommand = pair.started.event === 'operation-started'
    const finishedAsCommand = pair.finished.event === 'operation-finished'
    if (startedAsCommand !== finishedAsCommand
      || (startedAsCommand && pair.started.processId !== pair.finished.processId)
      || pair.started.taskId !== pair.finished.taskId
      || pair.started.agentId !== pair.finished.agentId || pair.started.activity !== pair.finished.activity
      || pair.started.dependsOn.join('\0') !== pair.finished.dependsOn.join('\0')) {
      throw new Error(`Operation ${operationKey} has inconsistent start and finish metadata`)
    }
  }
  for (const [runId, pair] of runs) {
    if (pair.started === undefined || pair.finished === undefined) continue
    if (pair.started.taskId !== pair.finished.taskId || pair.started.agentId !== pair.finished.agentId
      || (pair.finished.parentRunId !== undefined && pair.started.parentRunId !== pair.finished.parentRunId)) {
      throw new Error(`Run ${runId} has inconsistent start and finish metadata`)
    }
  }
}

function toEpoch(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? epoch : undefined
}

function intervalUnion(intervals: Array<{ start: number; end: number }>, minimumConcurrency: number): number {
  const points = intervals.flatMap(({ start, end }) => [{ time: start, delta: 1 }, { time: end, delta: -1 }])
    .sort((left, right) => left.time - right.time || left.delta - right.delta)
  let active = 0
  let previous: number | undefined
  let duration = 0
  for (const point of points) {
    if (previous !== undefined && active >= minimumConcurrency) duration += point.time - previous
    active += point.delta
    previous = point.time
  }
  return duration
}

/** Summarize recorded events without treating unrecorded time as idle.
 * @param events - Validated events from one local trace.
 * @param runId - The root run whose descendant operations should be included.
 * @returns Recorded durations, intervals, outcomes, and explicit dependency links.
 */
export function summarizeTrace(events: TraceEvent[], runId: string): TraceSummary {
  const runEvents = events.filter((event): event is RunEvent => event.runId === runId && (event.event === 'run-started' || event.event === 'run-finished'))
  const start = runEvents.find(event => event.event === 'run-started')
  const finish = [...runEvents].reverse().find(event => event.event === 'run-finished')
  const runStartEpoch = toEpoch(start?.timestamp)
  const runFinishEpoch = toEpoch(finish?.timestamp)
  const runClockReversed = runStartEpoch !== undefined && runFinishEpoch !== undefined && runFinishEpoch < runStartEpoch
  const runDurationMs = runStartEpoch === undefined || runFinishEpoch === undefined || runClockReversed
    ? undefined
    : runFinishEpoch - runStartEpoch
  const runReference = start ?? finish
  const run: RunSummary | undefined = runReference === undefined ? undefined : {
    runId,
    taskId: runReference.taskId,
    agentId: runReference.agentId,
    ...(runReference.parentRunId === undefined ? {} : { parentRunId: runReference.parentRunId }),
    ...(start === undefined ? {} : { startedAt: start.timestamp, startedProcessId: start.processId }),
    ...(finish === undefined ? {} : { finishedAt: finish.timestamp, finishedProcessId: finish.processId }),
    ...(runDurationMs === undefined ? {} : { durationMs: runDurationMs }),
    status: start === undefined || finish === undefined ? 'incomplete' : runClockReversed ? 'clock-reversed' : 'complete',
  }
  const descendants = descendantRunIds(events, runId)
  const childRuns = descendants.map(childId => summarizeRun(events, childId))
  const includedRunIds = new Set([runId, ...descendants])
  const operationEvents = events.filter((event): event is OperationEvent => includedRunIds.has(event.runId)
    && (event.event === 'operation-started' || event.event === 'operation-finished' || event.event === 'span-started' || event.event === 'span-finished'))
  const operationKeys = new Map<string, { runId: string; operationId: string }>()
  for (const event of operationEvents) operationKeys.set(`${event.runId}/${event.operationId}`, { runId: event.runId, operationId: event.operationId })
  const operations = [...operationKeys.values()].map(({ runId: operationRunId, operationId }) => {
    const operationStart = operationEvents.find(event => event.runId === operationRunId && event.operationId === operationId && (event.event === 'operation-started' || event.event === 'span-started'))
    const operationFinish = operationEvents.find(event => event.runId === operationRunId && event.operationId === operationId && (event.event === 'operation-finished' || event.event === 'span-finished'))
    const reference = operationStart ?? operationFinish
    if (reference === undefined) throw new Error('Operation reference unexpectedly missing')
    const wallInterval = operationStart === undefined || operationFinish === undefined
      ? 'unknown'
      : Date.parse(operationFinish.timestamp) < Date.parse(operationStart.timestamp) ? 'reversed' : 'forward'
    const monotonicDuration = operationFinish?.event === 'operation-finished' ? operationFinish.durationMs : undefined
    const wallDuration = operationStart?.event === 'span-started' && operationFinish?.event === 'span-finished' && wallInterval === 'forward'
      ? Date.parse(operationFinish.timestamp) - Date.parse(operationStart.timestamp)
      : undefined
    const durationMs = monotonicDuration ?? wallDuration
    const durationBasis = monotonicDuration !== undefined ? 'monotonic' : wallDuration !== undefined ? 'wall' : 'unknown'
    return {
      runId: operationRunId,
      operationId,
      taskId: reference.taskId,
      agentId: reference.agentId,
      activity: reference.activity,
      dependsOn: reference.dependsOn,
      startObserved: operationStart !== undefined,
      finishObserved: operationFinish !== undefined,
      wallInterval,
      ...(operationStart === undefined ? {} : { startedAt: operationStart.timestamp, startedProcessId: operationStart.processId }),
      ...(operationFinish === undefined ? {} : { finishedAt: operationFinish.timestamp, finishedProcessId: operationFinish.processId }),
      ...(durationMs === undefined ? {} : { durationMs }),
      durationBasis,
      status: operationFinish === undefined
        ? 'incomplete'
        : operationFinish.event === 'operation-finished' || operationFinish.event === 'span-finished'
          ? operationFinish.status
          : 'incomplete',
      ...(operationFinish?.event === 'operation-finished' && operationFinish.exitCode !== undefined ? { exitCode: operationFinish.exitCode } : {}),
      ...(operationFinish?.event === 'operation-finished' && operationFinish.signal !== undefined ? { signal: operationFinish.signal } : {}),
      ...(operationFinish?.event === 'operation-finished' && operationFinish.failureCode !== undefined ? { failureCode: operationFinish.failureCode } : {}),
    } satisfies OperationSummary
  })
  const activityDurationMs = new Map<Activity, number>()
  for (const operation of operations) {
    if (operation.durationMs === undefined) continue
    activityDurationMs.set(operation.activity, (activityDurationMs.get(operation.activity) ?? 0) + operation.durationMs)
  }
  const completeIntervals = operations.flatMap((operation) => {
    const startEpoch = toEpoch(operation.startedAt)
    const endEpoch = toEpoch(operation.finishedAt)
    return startEpoch !== undefined && endEpoch !== undefined && endEpoch >= startEpoch ? [{ start: startEpoch, end: endEpoch }] : []
  })
  const runStart = toEpoch(run?.startedAt)
  const runEnd = toEpoch(run?.finishedAt)
  const hasUsableRunInterval = runStart !== undefined && runEnd !== undefined && runEnd >= runStart
  const clippedIntervals = !hasUsableRunInterval ? completeIntervals : completeIntervals.flatMap((interval) => {
    const clippedStart = Math.max(runStart, interval.start)
    const clippedEnd = Math.min(runEnd, interval.end)
    return clippedEnd >= clippedStart ? [{ start: clippedStart, end: clippedEnd }] : []
  })
  const operationWallUnionMs = intervalUnion(clippedIntervals, 1)
  const concurrentOperationWallMs = intervalUnion(clippedIntervals, 2)
  const childIntervals = childRuns.flatMap((child) => {
    const start = toEpoch(child.startedAt)
    const end = toEpoch(child.finishedAt)
    return start !== undefined && end !== undefined && end >= start ? [{ start, end }] : []
  })
  const completeSubagentIntervalCount = childIntervals.length
  const incompleteSubagentIntervalCount = childRuns.length - completeSubagentIntervalCount
  const clippedChildIntervals = !hasUsableRunInterval ? childIntervals : childIntervals.flatMap((interval) => {
    const clippedStart = Math.max(runStart, interval.start)
    const clippedEnd = Math.min(runEnd, interval.end)
    return clippedEnd >= clippedStart ? [{ start: clippedStart, end: clippedEnd }] : []
  })
  const subagentWallUnionMs = intervalUnion(clippedChildIntervals, 1)
  const concurrentSubagentWallMs = intervalUnion(clippedChildIntervals, 2)
  const observedWallUnionMs = intervalUnion([...clippedIntervals, ...clippedChildIntervals], 1)
  const dependencyEdges = operations.flatMap(operation => operation.dependsOn.map((predecessor) => {
    const matches = operations.filter(candidate => candidate.operationId === predecessor)
    if (matches.length === 0) return { predecessor, successor: operation.operationId, timing: 'missing' as const }
    if (matches.length > 1) return { predecessor, successor: operation.operationId, timing: 'ambiguous' as const }
    const predecessorOperation = matches[0]
    if (predecessorOperation === undefined) return { predecessor, successor: operation.operationId, timing: 'unknown' as const }
    const predecessorEnd = toEpoch(predecessorOperation.finishedAt)
    const successorStart = toEpoch(operation.startedAt)
    if (predecessorEnd === undefined || successorStart === undefined || predecessorOperation.wallInterval !== 'forward' || operation.wallInterval !== 'forward') return { predecessor, successor: operation.operationId, timing: 'unknown' as const }
    return { predecessor, successor: operation.operationId, timing: predecessorEnd <= successorStart ? 'precedes' as const : 'overlaps' as const }
  }))
  const byLabel = new Map<string, string[]>()
  for (const operation of operations) byLabel.set(`${operation.activity}:${operation.taskId}`, [...(byLabel.get(`${operation.activity}:${operation.taskId}`) ?? []), `${operation.runId}/${operation.operationId}`])
  const repeatedOperations = new Map([...byLabel].filter(([, ids]) => ids.length > 1))
  return {
    run,
    childRuns,
    operations,
    activityDurationMs,
    completedOperationDurationMs: operations.reduce((sum, operation) => sum + (operation.durationMs ?? 0), 0),
    operationWallUnionMs,
    concurrentOperationWallMs,
    subagentWallUnionMs,
    concurrentSubagentWallMs,
    completeSubagentIntervalCount,
    incompleteSubagentIntervalCount,
    observedWallUnionMs,
    ...(run?.durationMs === undefined ? {} : { unattributedWallMs: Math.max(0, run.durationMs - observedWallUnionMs) }),
    dependencyEdges,
    repeatedOperations,
  }
}

function summarizeRun(events: TraceEvent[], runId: string): RunSummary {
  const started = events.find((event): event is RunEvent => event.runId === runId && event.event === 'run-started')
  const finished = [...events].reverse().find((event): event is RunEvent => event.runId === runId && event.event === 'run-finished')
  const reference = started ?? finished
  if (reference === undefined) return { runId, taskId: 'unknown', agentId: 'unknown', status: 'incomplete' }
  const clockReversed = started !== undefined && finished !== undefined && Date.parse(finished.timestamp) < Date.parse(started.timestamp)
  return {
    runId,
    taskId: reference.taskId,
    agentId: reference.agentId,
    ...(reference.parentRunId === undefined ? {} : { parentRunId: reference.parentRunId }),
    ...(started === undefined ? {} : { startedAt: started.timestamp, startedProcessId: started.processId }),
    ...(finished === undefined ? {} : { finishedAt: finished.timestamp, finishedProcessId: finished.processId }),
    ...(started === undefined || finished === undefined || clockReversed
      ? {}
      : { durationMs: Date.parse(finished.timestamp) - Date.parse(started.timestamp) }),
    status: started === undefined || finished === undefined ? 'incomplete' : clockReversed ? 'clock-reversed' : 'complete',
  }
}

function descendantRunIds(events: TraceEvent[], runId: string, visited = new Set([runId])): string[] {
  const children = [...new Set(events.filter((event): event is RunEvent => (event.event === 'run-started' || event.event === 'run-finished') && event.parentRunId === runId)
    .map(event => event.runId).filter(child => !visited.has(child)))]
  for (const child of children) visited.add(child)
  return children.flatMap(child => [child, ...descendantRunIds(events, child, visited)])
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return 'unknown'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(1)} s`
}

function formatTimestamp(timestamp: string | undefined, processId: number | undefined): string {
  return timestamp === undefined ? 'unknown' : `${timestamp} (recorder pid ${processId ?? 'unknown'})`
}

/** Render recorded time, overlap, waits, and unattributed time separately.
 * @param summary - The summarized run events.
 * @returns A plain text report without command arguments or output.
 */
export function renderTraceReport(summary: TraceSummary): string {
  const lines = ['Development run timing report', '']
  if (summary.run === undefined) lines.push('Run wall duration: unknown (no run start event recorded)')
  else lines.push(`Run ${summary.run.runId} (${summary.run.taskId}, ${summary.run.agentId}): ${formatDuration(summary.run.durationMs)}${summary.run.status === 'incomplete' ? summary.run.startedAt === undefined ? ' (start unknown)' : ' (end unknown)' : summary.run.status === 'clock-reversed' ? ' (wall timestamps reversed)' : ''}; start ${formatTimestamp(summary.run.startedAt, summary.run.startedProcessId)}, end ${formatTimestamp(summary.run.finishedAt, summary.run.finishedProcessId)}.`)
  lines.push('Source: explicit local dev:trace events; command arguments and output are not captured.')
  lines.push(`Recorded operation time: ${formatDuration(summary.completedOperationDurationMs)} cumulative across monotonic command durations and bracketed wall spans; overlaps may be counted more than once.`)
  lines.push(`Observed operation wall-clock union: ${formatDuration(summary.operationWallUnionMs)}; concurrent operation overlap: ${formatDuration(summary.concurrentOperationWallMs)} (cross-process timestamps).`)
  lines.push(`Observed subagent run wall-clock union: ${formatDuration(summary.subagentWallUnionMs)} across ${summary.completeSubagentIntervalCount} complete interval(s); concurrent subagent overlap: ${formatDuration(summary.concurrentSubagentWallMs)}; ${summary.incompleteSubagentIntervalCount} incomplete or reversed interval(s) remain unknown.`)
  lines.push(`Combined observed interval union: ${formatDuration(summary.observedWallUnionMs)} (operation and subagent intervals are not double-counted).`)
  lines.push(`Run time outside observed operation and subagent intervals: ${formatDuration(summary.unattributedWallMs)} (may include unrecorded work, waiting, or unavailable intervals; idle status unknown).`)
  lines.push('', 'Time by activity (cumulative operation time):')
  if (summary.activityDurationMs.size === 0) lines.push('- None recorded.')
  else for (const [activity, duration] of summary.activityDurationMs) lines.push(`- ${activity}: ${formatDuration(duration)}`)
  lines.push('', 'Operations:')
  if (summary.operations.length === 0) lines.push('- None recorded.')
  else for (const operation of summary.operations) {
    const outcome = !operation.finishObserved
      ? 'incomplete; end and outcome unknown'
      : !operation.startObserved
        ? `${operation.status}; start timestamp unknown`
        : `${operation.status}${operation.failureCode ? ` (${operation.failureCode})` : ''}${operation.exitCode === undefined ? '' : ` (exit ${String(operation.exitCode)})`}${operation.signal ? ` (${operation.signal})` : ''}`
    const intervalNote = operation.wallInterval === 'reversed' ? '; wall interval reversed, overlap unknown' : operation.wallInterval === 'unknown' ? '; wall interval unknown' : ''
    const durationBasis = operation.durationBasis === 'monotonic' ? 'monotonic' : operation.durationBasis === 'wall' ? 'wall-clock span' : 'duration basis unknown'
    const dependency = operation.dependsOn.length === 0 ? 'no dependency declared' : `declared dependency on ${operation.dependsOn.join(', ')}`
    const interval = `start ${formatTimestamp(operation.startedAt, operation.startedProcessId)}, end ${formatTimestamp(operation.finishedAt, operation.finishedProcessId)}`
    lines.push(`- ${operation.activity} ${operation.taskId}/${operation.operationId}: ${formatDuration(operation.durationMs)} (${durationBasis}), ${outcome}${intervalNote}; ${interval}; ${dependency}.`)
  }
  lines.push('', 'Coordinator waits:')
  const waits = summary.operations.filter(operation => operation.activity === 'wait' && operation.runId === summary.run?.runId)
  if (waits.length === 0) lines.push('- None recorded.')
  else for (const wait of waits) lines.push(`- ${wait.operationId}: ${formatDuration(wait.durationMs)}; waiting is not classified as waste.`)
  const childWaits = summary.operations.filter(operation => operation.activity === 'wait' && operation.runId !== summary.run?.runId)
  if (childWaits.length > 0) lines.push(`Subagent waits: ${childWaits.map(wait => `${wait.agentId}/${wait.operationId} ${formatDuration(wait.durationMs)}`).join('; ')}.`)
  lines.push('', 'Subagent runs:')
  if (summary.childRuns.length === 0) lines.push('- None recorded.')
  else for (const child of summary.childRuns) {
    const interval = `start ${formatTimestamp(child.startedAt, child.startedProcessId)}, end ${formatTimestamp(child.finishedAt, child.finishedProcessId)}${child.status === 'clock-reversed' ? ' (wall timestamps reversed)' : ''}`
    lines.push(`- ${child.taskId}/${child.agentId} (${child.runId}): ${formatDuration(child.durationMs)} (${interval}).`)
  }
  lines.push('', 'Declared dependency links:')
  if (summary.dependencyEdges.length === 0) lines.push('- None recorded; dependency path membership is unknown.')
  else for (const edge of summary.dependencyEdges) {
    const timing = edge.timing === 'precedes'
      ? 'predecessor completion timestamp precedes successor start'
      : edge.timing === 'overlaps'
        ? 'recorded intervals overlap; declared order is not reflected in the trace'
        : edge.timing === 'missing'
          ? 'predecessor operation is absent from the trace'
          : edge.timing === 'ambiguous'
            ? 'predecessor ID matches multiple operations'
            : 'timestamp order unknown'
    lines.push(`- ${edge.predecessor} -> ${edge.successor}: ${timing}.`)
  }
  lines.push('Critical path: not established; unrecorded implementation, reviews, external latency, and missing links are not modeled.')
  if (summary.repeatedOperations.size > 0) {
    lines.push('', 'Repeated activity/task labels (not evidence of avoidable work):')
    for (const [label, ids] of summary.repeatedOperations) lines.push(`- ${label}: ${ids.join(', ')}`)
  }
  return `${lines.join('\n')}\n`
}

function parseCliOptions(args: string[], needsOperation: boolean): { mode: 'begin' | 'end' | 'run' | 'report' | 'span-start' | 'span-end'; options: CliOptions; command: string[] } {
  const separator = args.indexOf('--')
  const optionArgs = separator === -1 ? args : args.slice(0, separator)
  const command = separator === -1 ? [] : args.slice(separator + 1)
  const [mode, ...flags] = optionArgs
  if (mode !== 'begin' && mode !== 'end' && mode !== 'run' && mode !== 'report' && mode !== 'span-start' && mode !== 'span-end') {
    throw new Error('Expected mode: begin, end, run, report, span-start, or span-end')
  }
  const parsed = parseArgs({
    args: flags,
    options: {
      trace: { type: 'string' },
      'run-id': { type: 'string' },
      'parent-run-id': { type: 'string' },
      task: { type: 'string' },
      agent: { type: 'string' },
      operation: { type: 'string' },
      activity: { type: 'string' },
      status: { type: 'string' },
      'depends-on': { type: 'string', multiple: true, default: [] },
    },
    strict: true,
    allowPositionals: false,
  })
  const { values } = parsed
  const runId = values['run-id']
  if (!isIdentifier(runId)) throw new Error('A sanitized --run-id is required')
  const taskId = values.task ?? 'development'
  const agentId = values.agent ?? 'coordinator'
  if (!isIdentifier(taskId) || !isIdentifier(agentId)) throw new Error('--task and --agent must be sanitized identifiers')
  const parentRunId = values['parent-run-id']
  if (parentRunId !== undefined && !isIdentifier(parentRunId)) throw new Error('--parent-run-id must be a sanitized identifier')
  const operationId = values.operation
  if (needsOperation && !isIdentifier(operationId)) throw new Error('--operation must be a sanitized identifier')
  const activityValue = values.activity
  if ((mode === 'run' || mode === 'span-start') && !isActivity(activityValue)) throw new Error(`--activity must be one of: ${ACTIVITIES.join(', ')}`)
  const spanStatus = values.status
  if (mode === 'span-end' && spanStatus !== 'completed' && spanStatus !== 'failed' && spanStatus !== 'unknown') {
    throw new Error('--status must be completed, failed, or unknown for span-end')
  }
  if (mode !== 'span-end' && spanStatus !== undefined) throw new Error('--status is only valid for span-end')
  const dependsOn = values['depends-on']
  if (!dependsOn.every(isIdentifier)) throw new Error('--depends-on values must be sanitized identifiers')
  if (mode === 'run' && command.length === 0) throw new Error('run mode requires a command after --')
  if (mode !== 'run' && command.length > 0) throw new Error('Only run mode accepts a command after --')
  return {
    mode,
    options: {
      trace: resolve(values.trace ?? `${DEFAULT_TRACE_ROOT}/${runId}.jsonl`),
      runId,
      ...(parentRunId === undefined ? {} : { parentRunId }),
      taskId,
      agentId,
      ...(operationId === undefined ? {} : { operationId }),
      ...(isActivity(activityValue) ? { activity: activityValue } : {}),
      ...(spanStatus === 'completed' || spanStatus === 'failed' || spanStatus === 'unknown' ? { spanStatus } : {}),
      dependsOn,
    },
    command,
  }
}

function appendEvent(trace: string, event: TraceEvent): void {
  mkdirSync(dirname(trace), { recursive: true })
  const descriptor = openSync(trace, 'a', 0o600)
  try {
    writeSync(descriptor, `${JSON.stringify(event)}\n`)
  } finally {
    closeSync(descriptor)
  }
}

/** Reject a start event that would make the same run and operation ambiguous. */
function assertOperationStartAvailable(trace: string, runId: string, operationId: string): void {
  if (!existsSync(trace)) return
  const events = parseTraceEvents(readFileSync(trace, 'utf8'))
  const alreadyStarted = events.some(event =>
    (event.event === 'operation-started' || event.event === 'span-started')
    && event.runId === runId && event.operationId === operationId)
  if (alreadyStarted) throw new Error(`Operation ${operationId} already has a start event in run ${runId}`)
}

async function runCommand(trace: string, options: CliOptions, command: string[]): Promise<number> {
  const operationId = options.operationId
  const activity = options.activity
  const executable = command[0]
  if (operationId === undefined || activity === undefined || executable === undefined) {
    throw new Error('run mode requires an operation, activity, and command')
  }
  assertOperationStartAvailable(trace, options.runId, operationId)
  const startedAt = new Date().toISOString()
  const monotonicStart = performance.now()
  const common = {
    version: FORMAT_VERSION,
    processId: process.pid,
    runId: options.runId,
    operationId,
    taskId: options.taskId,
    agentId: options.agentId,
    activity,
    dependsOn: options.dependsOn,
  } as const
  appendEvent(trace, { ...common, event: 'operation-started', timestamp: startedAt, monotonicMs: monotonicStart })
  const finish = (status: ProcessStatus, exitCode?: number | null, signal?: string | null, failureCode?: string): void => {
    appendEvent(trace, {
      ...common,
      event: 'operation-finished',
      timestamp: new Date().toISOString(),
      durationMs: performance.now() - monotonicStart,
      status,
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(signal === undefined ? {} : { signal }),
    })
  }
  const result = await execa(executable, command.slice(1), { stdio: 'inherit', reject: false, killDescendants: true })
    .catch((spawnError: unknown) => {
      const failureCode = safeFailureCode(spawnError)
      finish('spawn-failed', 1, undefined, failureCode)
      return undefined
    })
  if (result === undefined) return 1
  const status = result.signal ? 'signaled' : result.exitCode === 0 ? 'succeeded' : 'failed'
  finish(status, result.exitCode, result.signal)
  return status === 'succeeded' ? 0 : (result.exitCode ?? 1)
}

function safeFailureCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string' || !/^[A-Z0-9_]{2,48}$/u.test(error.code)) return undefined
  return error.code
}

async function main(args: string[]): Promise<void> {
  const { mode, options, command } = parseCliOptions(args, args[0] === 'run' || args[0] === 'span-start' || args[0] === 'span-end')
  if (mode === 'begin' || mode === 'end') {
    appendEvent(options.trace, {
      version: FORMAT_VERSION,
      event: mode === 'begin' ? 'run-started' : 'run-finished',
      timestamp: new Date().toISOString(),
      processId: process.pid,
      runId: options.runId,
      taskId: options.taskId,
      agentId: options.agentId,
      ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
    })
    return
  }
  if (mode === 'run') {
    const exitCode = await runCommand(options.trace, options, command)
    process.exitCode = exitCode
    return
  }
  if (mode === 'span-start') {
    const operationId = options.operationId
    const activity = options.activity
    if (operationId === undefined || activity === undefined) throw new Error('span-start requires an operation and activity')
    assertOperationStartAvailable(options.trace, options.runId, operationId)
    appendEvent(options.trace, {
      version: FORMAT_VERSION,
      event: 'span-started',
      timestamp: new Date().toISOString(),
      processId: process.pid,
      runId: options.runId,
      operationId,
      taskId: options.taskId,
      agentId: options.agentId,
      activity,
      dependsOn: options.dependsOn,
    })
    return
  }
  if (mode === 'span-end') {
    const operationId = options.operationId
    const status = options.spanStatus
    if (operationId === undefined || status === undefined) throw new Error('span-end requires an operation and status')
    const events = parseTraceEvents(readFileSync(options.trace, 'utf8'))
    const started = events.find((event): event is Extract<OperationEvent, { event: 'span-started' }> =>
      event.event === 'span-started' && event.runId === options.runId && event.operationId === operationId)
    if (started === undefined) throw new Error('No matching external span start is recorded')
    if (events.some(event => event.event === 'span-finished' && event.runId === options.runId && event.operationId === operationId)) {
      throw new Error('The external span already has a finish event')
    }
    appendEvent(options.trace, {
      ...started,
      event: 'span-finished',
      timestamp: new Date().toISOString(),
      processId: process.pid,
      status,
    })
    return
  }
  const events = parseTraceEvents(readFileSync(options.trace, 'utf8'))
  process.stdout.write(renderTraceReport(summarizeTrace(events, options.runId)))
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Could not process development trace'}\n`)
    process.exitCode = 1
  }
}
