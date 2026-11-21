import { describe, expect, it } from 'vitest'

import { parseTraceEvents, renderTraceReport, summarizeTrace } from './dev-run-trace.ts'

const run = (event: 'run-started' | 'run-finished', timestamp: string) => ({
  version: 1,
  event,
  timestamp,
  processId: 100,
  runId: 'run-a',
  taskId: 'issue-36',
  agentId: 'coordinator',
})

const operation = (
  event: 'operation-started' | 'operation-finished',
  operationId: string,
  timestamp: string,
  durationMs?: number,
  status?: 'succeeded' | 'failed',
  dependsOn: string[] = [],
) => ({
  version: 1,
  event,
  timestamp,
  processId: 101,
  runId: 'run-a',
  operationId,
  taskId: 'validation',
  agentId: 'reviewer-1',
  activity: 'test',
  dependsOn,
  ...(event === 'operation-started' ? { monotonicMs: 20 } : { durationMs, status }),
})

describe('development run trace', () => {
  it('uses monotonic operation duration while retaining wall timestamps for correlation', () => {
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:00.000Z')),
      JSON.stringify(operation('operation-started', 'test-a', '2026-11-21T12:00:01.000Z')),
      JSON.stringify(operation('operation-finished', 'test-a', '2026-11-21T12:00:04.000Z', 2875, 'succeeded')),
      JSON.stringify(run('run-finished', '2026-11-21T12:00:05.000Z')),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    expect(summary.run?.durationMs).toBe(5000)
    expect(summary.operations[0]?.durationMs).toBe(2875)
    expect(summary.activityDurationMs.get('test')).toBe(2875)
    expect(summary.unattributedWallMs).toBe(2000)
  })

  it('reports concurrent intervals without summing them as sequential wall time', () => {
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:00.000Z')),
      JSON.stringify(operation('operation-started', 'build', '2026-11-21T12:00:01.000Z')),
      JSON.stringify(operation('operation-finished', 'build', '2026-11-21T12:00:11.000Z', 10000, 'succeeded')),
      JSON.stringify(operation('operation-started', 'review', '2026-11-21T12:00:05.000Z', undefined, undefined, ['build'])),
      JSON.stringify(operation('operation-finished', 'review', '2026-11-21T12:00:13.000Z', 8000, 'succeeded', ['build'])),
      JSON.stringify(run('run-finished', '2026-11-21T12:00:14.000Z')),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    const report = renderTraceReport(summary)
    expect(summary.completedOperationDurationMs).toBe(18000)
    expect(summary.operationWallUnionMs).toBe(12000)
    expect(summary.concurrentOperationWallMs).toBe(6000)
    expect(summary.dependencyEdges).toEqual([{ predecessor: 'build', successor: 'review', timing: 'overlaps' }])
    expect(report).toContain('Recorded operation time: 18.0 s cumulative')
    expect(report).toContain('Observed operation wall-clock union: 12.0 s; concurrent operation overlap: 6.0 s')
    expect(report).toContain('build -> review: recorded intervals overlap')
    expect(report).toContain('Critical path: not established')
  })

  it('preserves failed outcomes and distinguishes waits without labeling them waste', () => {
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:00.000Z')),
      JSON.stringify({ ...operation('operation-started', 'wait-1', '2026-11-21T12:00:01.000Z'), activity: 'wait' }),
      JSON.stringify({ ...operation('operation-finished', 'wait-1', '2026-11-21T12:00:03.000Z', 2000, 'succeeded'), activity: 'wait' }),
      JSON.stringify(operation('operation-started', 'test-failed', '2026-11-21T12:00:04.000Z')),
      JSON.stringify({ ...operation('operation-finished', 'test-failed', '2026-11-21T12:00:05.000Z', 1000, 'failed'), exitCode: 1, failureCode: 'ENOENT' }),
      JSON.stringify(operation('operation-started', 'test-retry', '2026-11-21T12:00:05.100Z')),
      JSON.stringify(operation('operation-finished', 'test-retry', '2026-11-21T12:00:05.500Z', 400, 'succeeded')),
      JSON.stringify(run('run-finished', '2026-11-21T12:00:06.000Z')),
    ].join('\n'))

    const report = renderTraceReport(summarizeTrace(events, 'run-a'))
    expect(report).toContain('wait: 2.0 s')
    expect(report).toContain('waiting is not classified as waste')
    expect(report).toContain('test-failed: 1.0 s (monotonic), failed (ENOENT) (exit 1)')
    expect(report).toContain('Repeated activity/task labels (not evidence of avoidable work)')
    expect(report).toContain('run-a/test-failed, run-a/test-retry')
  })

  it('reports concurrent child runs and unions them with operation intervals without double-counting', () => {
    const childRun = (event: 'run-started' | 'run-finished', timestamp: string) => ({
      ...run(event, timestamp),
      runId: 'child-a',
      parentRunId: 'run-a',
      taskId: 'implementation',
      agentId: 'subagent-1',
    })
    const childOperation = (event: 'operation-started' | 'operation-finished', timestamp: string, durationMs?: number) => ({
      ...operation(event, 'child-tests', timestamp, durationMs, 'succeeded'),
      runId: 'child-a',
      agentId: 'subagent-1',
    })
    const overlappingChildRun = (event: 'run-started' | 'run-finished', timestamp: string) => ({
      ...run(event, timestamp),
      runId: 'child-b',
      parentRunId: 'run-a',
      taskId: 'review',
      agentId: 'subagent-2',
    })
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:00.000Z')),
      JSON.stringify(childRun('run-started', '2026-11-21T12:00:01.000Z')),
      JSON.stringify(overlappingChildRun('run-started', '2026-11-21T12:00:04.000Z')),
      JSON.stringify(childOperation('operation-started', '2026-11-21T12:00:02.000Z')),
      JSON.stringify(childOperation('operation-finished', '2026-11-21T12:00:07.000Z', 5000)),
      JSON.stringify(childRun('run-finished', '2026-11-21T12:00:08.000Z')),
      JSON.stringify(overlappingChildRun('run-finished', '2026-11-21T12:00:09.000Z')),
      JSON.stringify(run('run-finished', '2026-11-21T12:00:10.000Z')),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    const report = renderTraceReport(summary)
    expect(summary.operations).toHaveLength(1)
    expect(summary.operations[0]?.runId).toBe('child-a')
    expect(summary.operationWallUnionMs).toBe(5000)
    expect(summary.subagentWallUnionMs).toBe(8000)
    expect(summary.concurrentSubagentWallMs).toBe(4000)
    expect(summary.observedWallUnionMs).toBe(8000)
    expect(summary.unattributedWallMs).toBe(2000)
    expect(report).toContain('implementation/subagent-1 (child-a): 7.0 s')
    expect(report).toContain('Observed subagent run wall-clock union: 8.0 s across 2 complete interval(s); concurrent subagent overlap: 4.0 s; 0 incomplete or reversed interval(s) remain unknown')
    expect(report).toContain('start 2026-11-21T12:00:01.000Z (recorder pid 100), end 2026-11-21T12:00:08.000Z (recorder pid 100)')
  })

  it('measures manually bracketed host waits as wall spans', () => {
    const span = (event: 'span-started' | 'span-finished', timestamp: string, processId: number, status?: 'completed') => ({
      version: 1,
      event,
      timestamp,
      processId,
      runId: 'run-a',
      operationId: 'agent-wait',
      taskId: 'delegate-issue-20',
      agentId: 'coordinator',
      activity: 'wait',
      dependsOn: [],
      ...(status === undefined ? {} : { status }),
    })
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:00.000Z')),
      JSON.stringify(span('span-started', '2026-11-21T12:00:01.000Z', 101)),
      JSON.stringify(span('span-finished', '2026-11-21T12:00:04.000Z', 102, 'completed')),
      JSON.stringify(run('run-finished', '2026-11-21T12:00:05.000Z')),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    const report = renderTraceReport(summary)
    expect(summary.operations[0]?.durationMs).toBe(3000)
    expect(summary.operations[0]?.durationBasis).toBe('wall')
    expect(summary.operationWallUnionMs).toBe(3000)
    expect(report).toContain('wait: 3.0 s (wall-clock span), completed')
    expect(report).toContain('agent-wait: 3.0 s; waiting is not classified as waste')
  })

  it('leaves missing run and operation completion times unknown', () => {
    const childRun = {
      ...run('run-started', '2026-11-21T12:00:01.000Z'),
      runId: 'child-incomplete',
      parentRunId: 'run-a',
      taskId: 'implementation',
      agentId: 'subagent-1',
    }
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:00.000Z')),
      JSON.stringify(childRun),
      JSON.stringify(operation('operation-started', 'unfinished', '2026-11-21T12:00:01.000Z')),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    const report = renderTraceReport(summary)
    expect(summary.run?.durationMs).toBeUndefined()
    expect(summary.operations[0]?.durationMs).toBeUndefined()
    expect(report).toContain('Run run-a (issue-36, coordinator): unknown (end unknown)')
    expect(report).toContain('unfinished: unknown (duration basis unknown), incomplete; end and outcome unknown')
    expect(report).toContain('Run time outside observed operation and subagent intervals: unknown')
    expect(report).toContain('Observed subagent run wall-clock union: 0 ms across 0 complete interval(s); concurrent subagent overlap: 0 ms; 1 incomplete or reversed interval(s) remain unknown')
    expect(report).toContain('implementation/subagent-1 (child-incomplete): unknown (start 2026-11-21T12:00:01.000Z (recorder pid 100), end unknown)')
  })

  it('preserves finish timestamps and recorder process ids when run starts are missing', () => {
    const childFinish = {
      ...run('run-finished', '2026-11-21T12:00:03.000Z'),
      runId: 'child-finished',
      parentRunId: 'run-a',
      taskId: 'review',
      agentId: 'subagent-1',
    }
    const events = parseTraceEvents([
      JSON.stringify(run('run-finished', '2026-11-21T12:00:02.000Z')),
      JSON.stringify(childFinish),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    const report = renderTraceReport(summary)
    expect(summary.run).toMatchObject({
      runId: 'run-a', taskId: 'issue-36', status: 'incomplete',
      finishedAt: '2026-11-21T12:00:02.000Z', finishedProcessId: 100,
    })
    expect(summary.childRuns[0]).toMatchObject({
      runId: 'child-finished', taskId: 'review', status: 'incomplete',
      finishedAt: '2026-11-21T12:00:03.000Z', finishedProcessId: 100,
    })
    expect(report).toContain('Run run-a (issue-36, coordinator): unknown (start unknown); start unknown, end 2026-11-21T12:00:02.000Z (recorder pid 100)')
    expect(report).toContain('review/subagent-1 (child-finished): unknown (start unknown, end 2026-11-21T12:00:03.000Z (recorder pid 100))')
  })

  it('keeps monotonic duration but marks reversed wall timestamps unknown', () => {
    const events = parseTraceEvents([
      JSON.stringify(run('run-started', '2026-11-21T12:00:02.000Z')),
      JSON.stringify(operation('operation-started', 'clock-shift', '2026-11-21T12:00:03.000Z')),
      JSON.stringify(operation('operation-finished', 'clock-shift', '2026-11-21T12:00:01.000Z', 1800, 'succeeded')),
      JSON.stringify(run('run-finished', '2026-11-21T12:00:00.000Z')),
    ].join('\n'))

    const summary = summarizeTrace(events, 'run-a')
    const report = renderTraceReport(summary)
    expect(summary.run?.status).toBe('clock-reversed')
    expect(summary.run?.durationMs).toBeUndefined()
    expect(summary.operations[0]?.durationMs).toBe(1800)
    expect(summary.operationWallUnionMs).toBe(0)
    expect(report).toContain('wall timestamps reversed')
    expect(report).toContain('wall interval reversed, overlap unknown')
  })

  it('discards unrecognized fields so raw command or output data cannot enter the report', () => {
    const event = {
      ...operation('operation-started', 'safe-id', '2026-11-21T12:00:01.000Z'),
      command: 'private command text',
      output: 'private output text',
    }

    const events = parseTraceEvents(JSON.stringify(event))
    expect(JSON.stringify(events)).not.toContain('private')
  })
})
