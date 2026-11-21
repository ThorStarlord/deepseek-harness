import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '../src/index.ts'
import { SUBAGENT_DESCRIPTOR_VERSION } from '../src/descriptor.ts'
import { subagentIdentityProjectionDefinition, subagentTimingProjectionDefinition, type TimingState } from '../src/projection.ts'

function event(
  type: SessionEvent['type'],
  seq: number,
  time: number,
  reason: TurnEndReason = { kind: 'completed' },
): SessionEvent {
  return {
    type,
    seq,
    time,
    data: type === 'turn/end' ? { turn: 1, reason } : {},
  } as SessionEvent
}

function fold(events: SessionEvent[]) {
  let state: TimingState = subagentTimingProjectionDefinition.init()
  for (const item of events) state = subagentTimingProjectionDefinition.apply(state, item)
  return subagentTimingProjectionDefinition.wire.view(state)
}

describe('subagent timing projection', () => {
  it('preserves historical one-shot identity without inventing a label', () => {
    const descriptor = {
      ...event('subagent/descriptor', 1, 110),
      data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'spawn' },
    } as SessionEvent
    const state = subagentIdentityProjectionDefinition.apply(subagentIdentityProjectionDefinition.init(), descriptor)
    expect(subagentIdentityProjectionDefinition.wire.view(state)).toEqual({ mode: 'one-shot', seq: 1 })
  })

  it('retains a one-shot label and leaves malformed or newer descriptors unknown', () => {
    const labeled = {
      ...event('subagent/descriptor', 1, 110),
      data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'spawn', label: 'reviewer' },
    } as SessionEvent
    expect(subagentIdentityProjectionDefinition.wire.view(
      subagentIdentityProjectionDefinition.apply(subagentIdentityProjectionDefinition.init(), labeled),
    )).toEqual({ mode: 'one-shot', label: 'reviewer', seq: 1 })

    const malformed = {
      ...event('subagent/descriptor', 2, 120),
      data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn' },
    } as SessionEvent
    const newer = {
      ...event('subagent/descriptor', 3, 130),
      data: { version: SUBAGENT_DESCRIPTOR_VERSION + 1, mode: 'one-shot', provider: 'spawn' },
    } as SessionEvent
    for (const descriptor of [malformed, newer]) {
      expect(subagentIdentityProjectionDefinition.wire.view(
        subagentIdentityProjectionDefinition.apply(subagentIdentityProjectionDefinition.init(), descriptor),
      )).toBeNull()
    }
  })

  it('waits for the session projection registry and releases its projections on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await mountWorkingDirectoryFixture(ctx)
    const pending = ctx.plugin(SubagentRuntime)
    expect(ctx.get('subagents')).toBeUndefined()
    await ctx.plugin(SessionProjectionRegistry)
    const serviceFiber = await pending

    const before = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(before.subagentTiming).toEqual({ settledMs: 0 })
    // The identity unit registers alongside timing; an empty log serves its
    // serializable null sentinel.
    expect(before.subagent).toBeNull()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('subagent/descriptor', {
      version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'worker',
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } } })
    expect(ctx.sessionProjections.snapshot(session).values.subagentTiming)
      .toMatchObject({ lastTurnOutcome: 'failed' })
    session.append('turn/start', { turn: 2 })
    const active = ctx.sessionProjections.snapshot(session).values.subagentTiming?.active
    expect(active).toBeDefined()
    expect(typeof active?.since).toBe('number')
    expect(typeof active?.through).toBe('number')
    session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(ctx.sessionProjections.snapshot(session).values.subagentTiming)
      .toMatchObject({ lastTurnOutcome: 'cancelled' })
    await serviceFiber.dispose()
    const after = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(after.subagentTiming).toBeUndefined()
    expect(after.subagent).toBeUndefined()
  })

  it('resets inherited seed timing at the child descriptor and sums later completed turns', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 300),
      event('turn/start', 3, 1_000),
      event('subagent/descriptor', 4, 1_100),
      event('turn/end', 5, 4_100),
      event('turn/start', 6, 10_000),
      event('turn/end', 7, 12_000),
    ])).toEqual({ settledMs: 5_100, lastTurnOutcome: 'completed', lastTurnCompleted: true })
  })

  it('preserves the completion-only projection field for older consumers', () => {
    expect(subagentTimingProjectionDefinition.wire.viewSchema.parse({ settledMs: 0, lastTurnCompleted: true }))
      .toEqual({ settledMs: 0, lastTurnCompleted: true })
    expect(subagentTimingProjectionDefinition.wire.viewSchema.parse({
      settledMs: 0, lastTurnOutcome: 'failed', lastTurnCompleted: true,
    })).toEqual({ settledMs: 0, lastTurnOutcome: 'failed', lastTurnCompleted: false })
  })

  it('exposes an open turn start and never subtracts time for reversed boundaries', () => {
    expect(fold([
      event('turn/start', 0, 1_000),
      event('subagent/descriptor', 1, 1_100),
      event('turn/end', 2, 900),
      event('turn/start', 3, 2_000),
      event('assistant/attempt', 4, 2_500),
    ])).toEqual({ settledMs: 0, active: { since: 2_000, through: 2_500 } })
  })

  it('publishes the latest closed turn outcome and clears it when another turn opens', () => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
      event('turn/end', 4, 400, { kind: 'interrupted' }),
    ])).toEqual({ settledMs: 200, lastTurnOutcome: 'interrupted', lastTurnCompleted: false })

    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200),
      event('turn/start', 3, 300),
    ])).toEqual({ settledMs: 100, active: { since: 300, through: 300 } })
  })

  it.each([
    [{ kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } }, 'failed'],
    [{ kind: 'aborted', reason: { kind: 'user' } }, 'cancelled'],
    [{ kind: 'blocked' }, 'blocked'],
    [{ kind: 'max-tokens' }, 'token-limit'],
    [{ kind: 'forked' }, 'other'],
  ] as const)('classifies the durable turn end %s', (reason, outcome) => {
    expect(fold([
      event('turn/start', 0, 100),
      event('subagent/descriptor', 1, 110),
      event('turn/end', 2, 200, reason),
    ])).toMatchObject({ lastTurnOutcome: outcome })
  })

  it('ignores completed pre-descriptor turns and unrelated events', () => {
    const initial = subagentTimingProjectionDefinition.init()
    expect(subagentTimingProjectionDefinition.apply(
      initial,
      event('assistant/attempt', 0, 1),
    )).toBe(initial)
    expect(subagentTimingProjectionDefinition.apply(
      initial,
      event('turn/end', 1, 2),
    )).toBe(initial)
    const descriptor = subagentTimingProjectionDefinition.apply(
      initial,
      event('subagent/descriptor', 2, 3),
    )
    expect(subagentTimingProjectionDefinition.apply(
      descriptor,
      event('turn/end', 3, 4),
    )).toBe(descriptor)
    expect(fold([
      event('turn/start', 0, 100),
      event('turn/end', 1, 200),
      event('subagent/descriptor', 2, 300),
    ])).toEqual({ settledMs: 0 })
  })
})
