import { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { ActivityId } from '@deepseek-ai/dsh-home-activity'
import {
  ActivityArtifactError,
  ActivityArtifactStorageError,
  type ActivityArtifactErrorCode,
} from '@deepseek-ai/dsh-home-activity/artifacts'
import { StorageError } from '@deepseek-ai/dsh-storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeActivityArtifactCommand, renderActivityArtifacts } from '../src/artifact-command.ts'
import { executeActivityContinuation } from '../src/continuation-command.ts'
import { executeActivityDelegation } from '../src/delegation-command.ts'

vi.mock('../src/delegation-command.ts', () => ({ executeActivityDelegation: vi.fn() }))

const activityId = '00000000-0000-4000-8000-000000000011'
const delegationId = '00000000-0000-4000-8000-000000000021'
const workspaceId = '00000000-0000-4000-8000-000000000031'
const unavailableWorkspaceId = '00000000-0000-4000-8000-000000000032'
const unlinkedWorkspaceId = '00000000-0000-4000-8000-000000000033'
const mismatchedDelegationId = '00000000-0000-4000-8000-000000000022'
const missingDelegationId = '00000000-0000-4000-8000-000000000023'

afterEach(() => vi.mocked(executeActivityDelegation).mockReset())

describe('Activity artifact command', () => {
  it.each([
    ['malformed arguments', `artifact add ${activityId}`],
    ['invalid Activity id', `artifact add invalid ${delegationId} ${workspaceId} {}`],
    ['invalid delegation id', `artifact add ${activityId} invalid ${workspaceId} {}`],
    ['invalid Workspace id', `artifact add ${activityId} ${delegationId} invalid ${JSON.stringify({ label: 'Patch output', location: 'src/result.ts' })}`],
    ['invalid JSON', `artifact add ${activityId} ${delegationId} ${workspaceId} {`],
    ['invalid artifact fields', `artifact add ${activityId} ${delegationId} ${workspaceId} {"label":"","location":"src/a.ts"}`],
    ['control characters', `artifact add ${activityId} ${delegationId} ${workspaceId} {"label":"reference","location":"src\\nfile.ts"}`],
  ])('rejects %s before persistence', async (_case, rawInput) => {
    const create = vi.fn()
    const result = await executeActivityArtifactCommand(context({ create }), invocation(rawInput))

    expect(result?.kind).toBe('error')
    if (_case === 'invalid Workspace id') expect(result?.text).toContain('Workspace id must be a UUID')
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects oversized artifact commands without claiming unrelated input', async () => {
    const ctx = context()
    const artifactResult = await executeActivityArtifactCommand(ctx, invocation(`artifact ${'x'.repeat(16_384)}`))
    const otherResult = await executeActivityArtifactCommand(ctx, invocation(`status ${'x'.repeat(16_384)}`))
    const unclaimed = await executeActivityArtifactCommand(ctx, invocation('status'))

    expect(artifactResult?.text).toContain('must not exceed 16384 bytes')
    expect(otherResult).toBeUndefined()
    expect(unclaimed).toBeUndefined()
  })

  it('records a pointer while reporting unavailable Session attribution and revision as unknown', async () => {
    const create = vi.fn(async () => artifactRow())
    const ctx = context({ create })
    const result = await executeActivityArtifactCommand(ctx, invocation(addInput()))

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      activityId, delegationId, workspaceId, label: 'Patch output', location: 'src/result.ts',
    }))
    expect(result?.kind).toBe('success')
    expect(result?.text).toContain('Requesting Session: unavailable')
    expect(result?.text).toContain('Source revision: unknown')
    expect(result?.text).toContain('does not verify execution context')
  })

  it.each([
    ['unknown-activity', 'Run /activity list'],
    ['unknown-delegation', `/activity open ${activityId}`],
    ['delegation-activity-mismatch', 'Choose a delegation recorded for this Activity'],
    ['workspace-not-linked', `/activity link ${activityId} workspace <workspace-id>`],
    ['unknown-workspace', 'Run /activity workspaces'],
    ['artifact-limit', `/activity open ${activityId}`],
    ['invalid-reference', 'Check the label, location, and optional revision'],
  ] satisfies readonly [ActivityArtifactErrorCode, string][])('gives actionable recovery for %s', async (code, recovery) => {
    const result = await executeActivityArtifactCommand(
      context({ create: vi.fn(async () => { throw new ActivityArtifactError(code, `Rejected ${code}.`) }) }),
      invocation(addInput()),
    )

    expect(result?.kind).toBe('error')
    expect(result?.text).toContain(recovery)
  })

  it.each([
    ['artifact storage', new ActivityArtifactStorageError(new Error('private detail'))],
    ['shared storage', new StorageError('closed', 'private detail')],
  ])('does not confirm a pointer after %s failure', async (_case, error) => {
    const ctx = context({ create: vi.fn(async () => { throw error }) })
    const warning = vi.spyOn(ctx.logger, 'warn')
    const result = await executeActivityArtifactCommand(ctx, invocation(addInput()))

    expect(result?.text).toBe(`Artifact reference storage failed; no pointer was confirmed. Run /activity open ${activityId} before retrying.`)
    expect(warning).toHaveBeenCalledOnce()
  })

  it('keeps unexpected persistence failures generic and does not expose details', async () => {
    const ctx = context({ create: vi.fn(async () => { throw new Error('private persistence detail') }) })
    const warning = vi.spyOn(ctx.logger, 'warn')
    const result = await executeActivityArtifactCommand(ctx, invocation(addInput()))

    expect(result?.text).toBe('The selected Activity, delegation, or Workspace could not be confirmed; no pointer was recorded.')
    expect(result?.text).not.toContain('private persistence detail')
    expect(warning).toHaveBeenCalledOnce()
  })

  it('reports catalog read failure and the empty catalog distinctly', () => {
    const broken = context({ listArtifacts: vi.fn(() => { throw new Error('private read detail') }) })
    const warning = vi.spyOn(broken.logger, 'warn')
    expect(renderActivityArtifacts(broken, ActivityId(activityId))).toEqual([
      'Artifact references could not be read; no current pointer state was confirmed.',
    ])
    expect(warning).toHaveBeenCalledOnce()

    expect(renderActivityArtifacts(context(), ActivityId(activityId))).toEqual([
      'User-linked artifact references (not verified outputs):',
      'No artifact references.',
    ])
  })

  it('distinguishes stale, unavailable, and matched Workspace and delegation references', () => {
    const ctx = context({
      listArtifacts: vi.fn(() => [
        artifactRow({ id: 'stale', workspaceId: unlinkedWorkspaceId, delegationId: missingDelegationId }),
        artifactRow({ id: 'unavailable', workspaceId: unavailableWorkspaceId, delegationId: mismatchedDelegationId }),
        artifactRow({ id: 'matched', workspaceId, delegationId, revision: 'rev-a' }),
      ]),
      getAssociations: vi.fn(() => ({ workspaceIds: [workspaceId, unavailableWorkspaceId], sessionIds: [] })),
      getWorkspace: vi.fn((id: string) => id === workspaceId ? { id, title: 'Project', path: 'C:\\projects\\project' } : undefined),
      getDelegation: vi.fn((id: string) => id === delegationId
        ? { id, activityId, request: { provider: 'spawn', parentSessionId: 'session-parent' }, status: 'reported' }
        : id === mismatchedDelegationId
          ? { id, activityId: '00000000-0000-4000-8000-000000000012', request: { provider: 'spawn', parentSessionId: 'session-other' }, status: 'reported' }
          : undefined),
    })

    const rendered = renderActivityArtifacts(ctx, ActivityId(activityId)).join('\n')
    expect(rendered).toContain(`User-selected Workspace context no longer linked to this Activity: ${unlinkedWorkspaceId}.`)
    expect(rendered).toContain(`User-selected Workspace context unavailable: ${unavailableWorkspaceId}.`)
    expect(rendered).toContain(`User-selected Workspace context (execution Workspace unverified): Project — ${workspaceId}`)
    expect(rendered).toContain('Workspace directory: C:\\projects\\project')
    expect(rendered).toContain(`Delegation reference unavailable: ${missingDelegationId}.`)
    expect(rendered).toContain(`Delegation reference unavailable: ${mismatchedDelegationId}.`)
    expect(rendered).toContain(`Delegation: ${delegationId} (spawn; reported)`)
    expect(rendered).toContain('Source revision: rev-a')
    expect(rendered).toContain('its producer and contents are not independently verified')
  })
})

describe('Activity continuation command', () => {
  it.each([
    ['malformed syntax', 'not a continuation', 'Usage: /activity continue'],
    ['invalid Activity id', 'invalid spawn in-scope:1 inspect', 'Activity id must be a UUID'],
    ['blank bounded step', `${activityId} spawn in-scope:1   `, 'A bounded next step is required'],
  ])('rejects %s without delegation', async (_case, rawInput, message) => {
    const result = await executeActivityContinuation(context(), invocation(''), rawInput)

    expect(result.kind).toBe('error')
    expect(result.text).toContain(message)
    expect(executeActivityDelegation).not.toHaveBeenCalled()
  })

  it('reports uncertain or absent Activity lookup without attempting a provider call', async () => {
    const failedLookup = context({ getActivity: vi.fn(() => { throw new Error('private lookup detail') }) })
    const warning = vi.spyOn(failedLookup.logger, 'warn')
    const failed = await executeActivityContinuation(failedLookup, invocation(''), `${activityId} spawn in-scope:1 inspect`)
    const absent = await executeActivityContinuation(context(), invocation(''), `${activityId} spawn in-scope:1 inspect`)

    expect(failed.text).toBe('Activity state could not be confirmed; no provider call was attempted.')
    expect(absent.text).toBe(`No saved Activity has id ${activityId}.`)
    expect(warning).toHaveBeenCalledOnce()
    expect(executeActivityDelegation).not.toHaveBeenCalled()
  })

  it.each([
    ['out-of-scope', 'out-of-scope:1', 'An out-of-scope statement cannot be continued'],
    ['zero index', 'in-scope:0', 'Choose an existing in-scope statement'],
    ['out-of-range index', 'in-scope:2', 'Choose an existing in-scope statement'],
    ['unsafe index', 'in-scope:9007199254740992', 'Choose an existing in-scope statement'],
  ])('refuses %s statements without delegation', async (_case, selector, message) => {
    const result = await executeActivityContinuation(
      context({ getActivity: vi.fn(() => savedActivity()) }), invocation(''),
      `${activityId} spawn ${selector} inspect`,
    )

    expect(result.text).toContain(message)
    expect(executeActivityDelegation).not.toHaveBeenCalled()
  })

  it('forwards a bounded in-scope step and distinguishes successful provider admission', async () => {
    vi.mocked(executeActivityDelegation).mockResolvedValue({ kind: 'success' })
    const result = await executeActivityContinuation(
      context({ getActivity: vi.fn(() => savedActivity()) }), invocation(''),
      `${activityId} spawn in-scope:1 inspect the existing branch`,
    )
    const forwarded = vi.mocked(executeActivityDelegation).mock.calls[0]?.[2]

    expect(forwarded).toContain('Continue the saved Activity objective: "Improve the local harness"')
    expect(forwarded).toContain('Selected in-scope statement 1: "Review existing tests"')
    expect(forwarded).toContain('User-requested bounded next step: "inspect the existing branch"')
    expect(result).toEqual({
      kind: 'success', text: 'This is a new explicit provider request, not a resume of prior execution.',
    })
  })

  it('preserves delegation rejection without calling it a continuation success', async () => {
    vi.mocked(executeActivityDelegation).mockResolvedValue({ kind: 'error', text: 'Admission was not confirmed.' })
    const result = await executeActivityContinuation(
      context({ getActivity: vi.fn(() => savedActivity()) }), invocation(''),
      `${activityId} spawn in-scope:1 inspect the existing branch`,
    )

    expect(result).toEqual({ kind: 'error', text: 'Admission was not confirmed.' })
  })
})

function context(options: {
  create?: (input: unknown) => Promise<unknown>
  listArtifacts?: () => readonly unknown[]
  getDelegation?: (id: string) => unknown
  getAssociations?: () => { workspaceIds: string[]; sessionIds: string[] }
  getWorkspace?: (id: string) => unknown
  getActivity?: (id: string) => unknown
} = {}): Context {
  const ctx = new Context()
  ctx.provide('homeActivityArtifacts', {
    create: options.create ?? vi.fn(async () => artifactRow()),
    list: options.listArtifacts ?? vi.fn(() => []),
  } as never)
  ctx.provide('homeActivityDelegations', { get: options.getDelegation ?? vi.fn(() => undefined) } as never)
  ctx.provide('homeActivityAssociations', {
    get: options.getAssociations ?? vi.fn(() => ({ workspaceIds: [], sessionIds: [] })),
  } as never)
  ctx.provide('workspaceRegistry', { get: options.getWorkspace ?? vi.fn(() => undefined) } as never)
  ctx.provide('homeActivities', { get: options.getActivity ?? vi.fn(() => undefined) } as never)
  return ctx
}

function invocation(rawInput: string): CommandInvocation {
  return {
    commandId: 'coverage-command' as never,
    agent: {} as never,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  }
}

function addInput(): string {
  return `artifact add ${activityId} ${delegationId} ${workspaceId} ${JSON.stringify({ label: 'Patch output', location: 'src/result.ts' })}`
}

function artifactRow(options: {
  id?: string
  activityId?: string
  delegationId?: string
  workspaceId?: string
  revision?: string
} = {}) {
  return {
    id: options.id ?? 'artifact-id',
    activityId: options.activityId ?? activityId,
    delegationId: options.delegationId ?? delegationId,
    workspaceId: options.workspaceId ?? workspaceId,
    label: 'Patch output',
    location: 'src/result.ts',
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    source: 'user-command',
    recordedAt: '2026-11-27T12:00:00.000Z',
  }
}

function savedActivity() {
  return {
    id: ActivityId(activityId),
    name: 'Harness Activity',
    objective: 'Improve the local harness',
    boundaries: { inScope: ['Review existing tests'], outOfScope: ['Change credentials'] },
    createdAt: '2026-11-27T12:00:00.000Z',
  }
}
