import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityAssociationService from '../src/associations.ts'
import HomeActivityDelegationService from '../src/delegations.ts'
import type { ActivityDelegationId } from '../src/delegations.ts'
import HomeActivityArtifactService, {
  ActivityArtifactError,
  ActivityArtifactStorageError,
  MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY,
} from '../src/artifacts.ts'
import { activityDelegationId } from '../src/delegations.ts'
import type { CreateActivityRequest } from '../src/types.ts'

const contexts: Context[] = []
const activityRequest: CreateActivityRequest = {
  name: 'Cross-repository release',
  objective: 'Review two repository outputs.',
  boundaries: { inScope: ['Inspect reported artifacts.'], outOfScope: ['Do not merge or release.'] },
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function workspace(id: string, title: string): Workspace {
  return {
    id: WorkspaceId(id),
    title,
    path: `C:\\projects\\${title}`,
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
    sessionIds: [],
    setTitle: async (_title: string) => {},
    attachSession: async (_sessionId: SessionId) => {},
    insertSessionBefore: async (_sessionId: SessionId, _beforeSessionId?: SessionId) => {},
    detachSession: async (_sessionId: SessionId) => {},
    status: async () => 'ok',
  }
}

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const workspaces = new Map<string, Workspace>([
    ['00000000-0000-4000-8000-000000000011', workspace('00000000-0000-4000-8000-000000000011', 'Repository one')],
    ['00000000-0000-4000-8000-000000000012', workspace('00000000-0000-4000-8000-000000000012', 'Repository two')],
  ])
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => workspaces.get(id), list: () => [...workspaces.values()] } as never)
  ctx.provide('sessionPersistence', { stat: vi.fn(async () => undefined), list: vi.fn(async () => []) } as never)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegationService)
  await ctx.plugin(HomeActivityAssociationService)
  await ctx.plugin(HomeActivityArtifactService)
  return { ctx, pool, workspaces }
}

async function createDelegation(ctx: Context, activityId: ActivityId, task: string, parentSessionId = 'parent-session') {
  return await ctx.homeActivityDelegations.createRequest({
    activityId,
    provider: 'spawn',
    task,
    parentSessionId: SessionId(parentSessionId),
  })
}

async function reportDelegation(ctx: Context, id: ActivityDelegationId, label: string): Promise<void> {
  const admission = {
    childSessionId: SessionId(`child-${label}`),
    activationName: `activity-${label}`,
    admittedAt: '2026-11-17T00:00:01.000Z',
    source: 'subagents.startActivation' as const,
  }
  await ctx.homeActivityDelegations.recordAdmitted(id, admission)
  await ctx.homeActivityDelegations.recordReported(id, admission, {
    stopReason: 'stop',
    outputText: `Provider report for ${label}.`,
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-17T00:00:02.000Z',
    source: 'subagent-activation-result',
  })
}

it('persists two Workspace-specific pointers and preserves missing revision as unknown after restart', async () => {
  const pool = new MemoryMediaPool()
  const first = await harness(pool)
  const activity = await first.ctx.homeActivities.create(activityRequest)
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  await first.ctx.homeActivityAssociations.linkWorkspace(activity.id, firstWorkspace)
  await first.ctx.homeActivityAssociations.linkWorkspace(activity.id, secondWorkspace)
  const firstDelegation = await createDelegation(first.ctx, activity.id, 'Review repository one output.', 'parent-session-one')
  const secondDelegation = await createDelegation(first.ctx, activity.id, 'Review repository two output.', 'parent-session-two')
  await reportDelegation(first.ctx, firstDelegation.id, 'repository-one')
  await reportDelegation(first.ctx, secondDelegation.id, 'repository-two')
  const firstPointer = await first.ctx.homeActivityArtifacts.create({
    activityId: activity.id,
    delegationId: firstDelegation.id,
    workspaceId: firstWorkspace,
    label: 'Repository one report',
    location: 'reports/review.md',
  })
  const secondPointer = await first.ctx.homeActivityArtifacts.create({
    activityId: activity.id,
    delegationId: secondDelegation.id,
    workspaceId: secondWorkspace,
    label: 'Repository two patch',
    location: 'src/change.ts',
    revision: 'a'.repeat(40),
  })
  expect(firstPointer.revision).toBeUndefined()
  expect(secondPointer.revision).toBe('a'.repeat(40))
  const firstDelegationBeforeRestart = first.ctx.homeActivityDelegations.get(firstDelegation.id)
  const secondDelegationBeforeRestart = first.ctx.homeActivityDelegations.get(secondDelegation.id)
  expect(firstDelegationBeforeRestart).toMatchObject({
    status: 'reported', request: { task: 'Review repository one output.', parentSessionId: 'parent-session-one' },
  })
  expect(secondDelegationBeforeRestart).toMatchObject({
    status: 'reported', request: { task: 'Review repository two output.', parentSessionId: 'parent-session-two' },
  })
  expect(first.pool.media.has('home_activity_artifacts')).toBe(true)
  expect(first.pool.media.has('home_activity_delegations')).toBe(true)
  await first.ctx.fiber.dispose()

  const reopened = await harness(pool)
  const saved = reopened.ctx.homeActivityArtifacts.list(activity.id)
  expect(saved).toHaveLength(2)
  expect(saved).toEqual(expect.arrayContaining([
    expect.objectContaining({ delegationId: firstDelegation.id, workspaceId: firstWorkspace, location: 'reports/review.md' }),
    expect.objectContaining({ delegationId: secondDelegation.id, workspaceId: secondWorkspace, location: 'src/change.ts', revision: 'a'.repeat(40) }),
  ]))
  expect(reopened.ctx.homeActivityDelegations.get(firstDelegation.id)).toEqual(firstDelegationBeforeRestart)
  expect(reopened.ctx.homeActivityDelegations.get(secondDelegation.id)).toEqual(secondDelegationBeforeRestart)
})

it('rejects a delegation from another Activity and a Workspace not linked to the owning Activity', async () => {
  const test = await harness()
  const first = await test.ctx.homeActivities.create(activityRequest)
  const second = await test.ctx.homeActivities.create({ ...activityRequest, name: 'Other Activity' })
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  await test.ctx.homeActivityAssociations.linkWorkspace(first.id, firstWorkspace)
  await test.ctx.homeActivityAssociations.linkWorkspace(second.id, secondWorkspace)
  await test.ctx.homeActivityAssociations.linkWorkspace(first.id, secondWorkspace)
  const firstDelegation = await createDelegation(test.ctx, first.id, 'First Activity task.')
  const secondDelegation = await createDelegation(test.ctx, second.id, 'Second Activity task.')

  await expect(test.ctx.homeActivityArtifacts.create({
    activityId: first.id,
    delegationId: secondDelegation.id,
    workspaceId: secondWorkspace,
    label: 'Misattributed output',
    location: 'output.md',
  })).rejects.toMatchObject({ code: 'delegation-activity-mismatch' })
  await expect(test.ctx.homeActivityArtifacts.create({
    activityId: first.id,
    delegationId: firstDelegation.id,
    workspaceId: WorkspaceId('00000000-0000-4000-8000-000000000099'),
    label: 'Unlinked output',
    location: 'output.md',
  })).rejects.toMatchObject({ code: 'workspace-not-linked' })
  expect(test.ctx.homeActivityArtifacts.list(first.id)).toEqual([])
  expect(test.ctx.homeActivityArtifacts.list(second.id)).toEqual([])
})

it('rejects malformed durable pointer rows and returns detached read-only records', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(activityRequest)
  const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000011')
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceId)
  const delegation = await createDelegation(test.ctx, activity.id, 'Review an output.')
  await expect(test.ctx.homeActivityArtifacts.create({
    activityId: activity.id,
    delegationId: delegation.id,
    workspaceId,
    label: 'Invalid\nlabel',
    location: 'report.md',
  })).rejects.toMatchObject({ code: 'invalid-reference' })
  await expect(test.ctx.homeActivityArtifacts.create({
    activityId: activity.id,
    delegationId: delegation.id,
    workspaceId,
    label: 'Report',
    location: 'report.md\nforged status: accepted',
  })).rejects.toMatchObject({ code: 'invalid-reference' })
  const saved = await test.ctx.homeActivityArtifacts.create({
    activityId: activity.id,
    delegationId: delegation.id,
    workspaceId,
    label: 'Report',
    location: 'report.md',
  })
  expect(Object.isFrozen(saved)).toBe(true)
  expect(Object.isFrozen(test.ctx.homeActivityArtifacts.list(activity.id))).toBe(true)
})

it('rejects missing references, preserves the artifact limit, and wraps storage failures', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(activityRequest)
  const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000011')
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceId)
  const delegation = await createDelegation(test.ctx, activity.id, 'Review a repository output.')
  const request = { activityId: activity.id, delegationId: delegation.id, workspaceId, label: 'Report', location: 'report.md' }

  await expect(test.ctx.homeActivityArtifacts.create({ ...request, activityId: ActivityId('00000000-0000-4000-8000-000000000099') }))
    .rejects.toMatchObject({ code: 'unknown-activity' })
  await expect(test.ctx.homeActivityArtifacts.create({ ...request, delegationId: activityDelegationId('00000000-0000-4000-8000-000000000099') }))
    .rejects.toMatchObject({ code: 'unknown-delegation' })

  const missingWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000013')
  test.workspaces.set(missingWorkspaceId, workspace(String(missingWorkspaceId), 'Temporary repository'))
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, missingWorkspaceId)
  test.workspaces.delete(missingWorkspaceId)
  await expect(test.ctx.homeActivityArtifacts.create({ ...request, workspaceId: missingWorkspaceId }))
    .rejects.toMatchObject({ code: 'unknown-workspace' })
  expect(() => test.ctx.homeActivityArtifacts.list(ActivityId('00000000-0000-4000-8000-000000000099')))
    .toThrow(ActivityArtifactError)

  const pool = new MemoryMediaPool()
  const persistent = await harness(pool)
  const persistedActivity = await persistent.ctx.homeActivities.create(activityRequest)
  await persistent.ctx.homeActivityAssociations.linkWorkspace(persistedActivity.id, workspaceId)
  const persistedDelegation = await createDelegation(persistent.ctx, persistedActivity.id, 'Review the report.')
  pool.failNextWrites = 1
  await expect(persistent.ctx.homeActivityArtifacts.create({
    activityId: persistedActivity.id,
    delegationId: persistedDelegation.id,
    workspaceId,
    label: 'Report',
    location: 'report.md',
  })).rejects.toBeInstanceOf(ActivityArtifactStorageError)
  expect(persistent.ctx.homeActivityArtifacts.list(persistedActivity.id)).toEqual([])
})

it('enforces the per-Activity artifact reference limit', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(activityRequest)
  const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000011')
  await test.ctx.homeActivityAssociations.linkWorkspace(activity.id, workspaceId)
  const delegation = await createDelegation(test.ctx, activity.id, 'Review saved report pointers.')
  for (let index = 0; index < MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY; index += 1) {
    await test.ctx.homeActivityArtifacts.create({
      activityId: activity.id,
      delegationId: delegation.id,
      workspaceId,
      label: `Report ${index}`,
      location: `reports/${index}.md`,
    })
  }
  await expect(test.ctx.homeActivityArtifacts.create({
    activityId: activity.id,
    delegationId: delegation.id,
    workspaceId,
    label: 'Overflow report',
    location: 'reports/overflow.md',
  })).rejects.toMatchObject({ code: 'artifact-limit' })
  expect(test.ctx.homeActivityArtifacts.list(activity.id)).toHaveLength(MAX_HOME_ACTIVITY_ARTIFACTS_PER_ACTIVITY)
})

it('does not confuse a failed limit check read with an empty artifact history', async () => {
  const ctx = new Context(); contexts.push(ctx)
  const activityId = ActivityId('00000000-0000-4000-8000-000000000011')
  const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000012')
  ctx.provide('storageDomain', {
    open: async () => ({
      close: async () => {},
      table: () => ({ entries: () => { throw new Error('injected artifact history read failure') } }),
    }),
  } as never)
  ctx.provide('homeActivities', { get: () => ({ id: activityId }) } as never)
  ctx.provide('homeActivityDelegations', { get: () => ({ activityId }) } as never)
  ctx.provide('homeActivityAssociations', { get: () => ({ workspaceIds: [workspaceId] }) } as never)
  ctx.provide('workspaceRegistry', { get: () => workspace(String(workspaceId), 'Selected repository') } as never)
  await ctx.plugin(HomeActivityArtifactService)

  await expect(ctx.homeActivityArtifacts.create({
    activityId,
    delegationId: activityDelegationId('00000000-0000-4000-8000-000000000013'),
    workspaceId,
    label: 'Report',
    location: 'reports/result.md',
  })).rejects.toBeInstanceOf(ActivityArtifactStorageError)
  expect(() => ctx.homeActivityArtifacts.list(activityId)).toThrow(ActivityArtifactStorageError)

  const unreadyContext = new Context(); contexts.push(unreadyContext)
  unreadyContext.provide('homeActivities', { get: () => ({ id: activityId }) } as never)
  const unready = new HomeActivityArtifactService(unreadyContext)
  expect(() => unready.list(activityId)).toThrow(ActivityArtifactStorageError)
})
