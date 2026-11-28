import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import type { ActivityHandoff, ActivityHandoffId } from '@deepseek-ai/dsh-home-activity/handoffs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import {
  executeActivityAnnotationCommand,
  renderActivityAnnotations,
} from '../src/annotation-command.ts'
import {
  executeActivityHandoffCommand,
  renderActivityHandoffs,
} from '../src/handoff-command.ts'

const activityId = '123e4567-e89b-12d3-a456-426614174000'

it('reports malformed annotation JSON and schema errors without changing annotation history', async () => {
  const correct = vi.fn()
  const { ctx } = context({ correct, list: vi.fn(() => []) })

  const malformedJson = await executeActivityAnnotationCommand(ctx, invocation(` annotate ${activityId} {`))
  expect(malformedJson).toEqual({
    kind: 'error',
    text: 'Activity annotation must be valid JSON. Usage: /activity annotate <activity-id> <JSON> where JSON is {"text":"..."}',
  })

  const invalidSchema = await executeActivityAnnotationCommand(ctx, invocation(` annotate ${activityId} {"private":"value"}`))
  expect(invalidSchema?.kind).toBe('error')
  expect(invalidSchema?.text).toContain('Activity annotation is invalid:')
  expect(correct).not.toHaveBeenCalled()
})

it('keeps annotation command ownership and bounded syntax errors distinct', async () => {
  const { ctx } = context({ correct: vi.fn(), list: vi.fn(() => []) })

  expect(await executeActivityAnnotationCommand(ctx, invocation(' list'))).toBeUndefined()
  expect((await executeActivityAnnotationCommand(ctx, invocation(' annotate')))?.text)
    .toContain('Usage: /activity annotate')

  const oversized = await executeActivityAnnotationCommand(
    ctx,
    invocation(` annotate ${activityId} ${'x'.repeat(16_384)}`),
  )
  expect(oversized?.text).toContain('Activity annotation input must not exceed 16384 bytes.')
})

it('reports malformed handoff JSON and invalid details without recording a handoff', async () => {
  const create = vi.fn()
  const { ctx } = context(undefined, { create, list: vi.fn(() => []) })

  expect(await executeActivityHandoffCommand(ctx, invocation(' handoff'))).toMatchObject({
    kind: 'error', text: expect.stringContaining('Usage: /activity handoff add'),
  })
  expect(await executeActivityHandoffCommand(ctx, invocation(` handoff ${'x'.repeat(16_384)}`)))
    .toMatchObject({ kind: 'error', text: expect.stringContaining('must not exceed 16384 bytes') })

  const malformedJson = await executeActivityHandoffCommand(ctx, invocation(` handoff add ${activityId} {`))
  expect(malformedJson).toEqual({
    kind: 'error',
    text: 'External handoff details must be valid JSON. Usage: /activity handoff add <activity-id> <JSON>',
  })

  const invalidDetails = await executeActivityHandoffCommand(
    ctx,
    invocation(` handoff add ${activityId} {"source":""}`),
  )
  expect(invalidDetails?.kind).toBe('error')
  expect(invalidDetails?.text).toContain('External handoff details are invalid:')
  expect(create).not.toHaveBeenCalled()
})

it('preserves handoff source attribution and states absent optional references accurately', async () => {
  const recordedSessionId = SessionId('coverage-recording-session')
  const handoff: ActivityHandoff = {
    id: brandString<ActivityHandoffId>('handoff-coverage-1'),
    activityId: ActivityId(activityId),
    source: 'Operator console',
    artifacts: [{ label: 'Result', location: 'reports/result.md' }],
    recordedInSessionId: recordedSessionId,
    origin: 'user-supplied-external',
    recordedAt: '2026-11-27T12:00:00.000Z',
  }
  const create = vi.fn(async () => handoff)
  const list = vi.fn(() => [handoff])
  const { ctx } = context(undefined, { create, list })

  const result = await executeActivityHandoffCommand(
    ctx,
    invocation(` handoff add ${activityId} {"source":"Operator console","artifacts":[{"label":"Result","location":"reports/result.md"}]}`, recordedSessionId),
  )
  expect(result?.kind).toBe('success')
  expect(result?.text).toContain(`Recorded in DSH Session: ${recordedSessionId}`)
  expect(result?.text).toContain('This record does not import a native Session')
  expect(result?.text).not.toContain('User-supplied summary:')
  expect(result?.text).not.toContain('User-supplied source reference:')
  expect(result?.text).toContain('Artifact revision: unknown')
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ recordedInSessionId: recordedSessionId }))

  const lines = renderActivityHandoffs(ctx, ActivityId(activityId))
  expect(lines.join('\n')).toContain(`Recorded in DSH Session: ${recordedSessionId}`)
  expect(lines.join('\n')).toContain('Artifact revision: unknown')
  expect(lines.join('\n')).not.toContain('User-supplied summary:')
  expect(lines.join('\n')).not.toContain('User-supplied source reference:')
})

it('reports unreadable annotation and handoff histories without exposing storage diagnostics', () => {
  const { ctx } = context(
    { correct: vi.fn(), list: vi.fn(() => { throw new Error('private annotation path') }) },
    { create: vi.fn(), list: vi.fn(() => { throw new Error('private handoff path') }) },
    { warn: vi.fn() },
  )

  const annotations = renderActivityAnnotations(ctx, ActivityId(activityId))
  const handoffs = renderActivityHandoffs(ctx, ActivityId(activityId))
  expect(annotations.join('\n')).toContain('User annotations could not be read')
  expect(handoffs.join('\n')).toContain('External handoffs could not be read')
  expect(annotations.join('\n')).not.toContain('private annotation path')
  expect(handoffs.join('\n')).not.toContain('private handoff path')
})

function context(
  annotations?: { correct: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
  handoffs?: { create: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> },
  logger = { warn: vi.fn() },
): { readonly ctx: Context; readonly logger: typeof logger } {
  const ctx = new Context()
  ctx.provide('logger', logger as never)
  if (annotations !== undefined) ctx.provide('homeActivityAnnotations', annotations as never)
  if (handoffs !== undefined) ctx.provide('homeActivityHandoffs', handoffs as never)
  return { ctx, logger }
}

function invocation(rawInput: string, sessionId = SessionId('coverage-command-session')): CommandInvocation {
  return {
    commandId: brandString<'CommandId'>('cmd-coverage'),
    agent: { id: sessionId } as CommandInvocation['agent'],
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  }
}
