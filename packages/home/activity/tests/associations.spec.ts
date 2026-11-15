import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import HomeActivityService from '../src/index.ts'
import { ActivityId } from '../src/index.ts'
import HomeActivityAssociationService, { HomeActivityAssociationStorageError } from '../src/associations.ts'
import type { CreateActivityRequest } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const request: CreateActivityRequest = {
  name: 'Release readiness',
  objective: 'Prepare the next release for review.',
  boundaries: { inScope: ['Review release notes.'], outOfScope: ['Do not publish.'] },
}

function referenceWorkspace(id: string, title: string): Workspace {
  return {
    id: WorkspaceId(id),
    title,
    path: `C:\\projects\\${title}`,
    status: async () => 'ok',
  } as Workspace
}

function sessionSnapshot(id: string): SessionPersistenceSnapshot {
  return {
    header: {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(id),
      createdAt: Date.UTC(2026, 10, 15),
      isSeeded: false,
      cwd: `C:\\sessions\\${id}`,
    },
    revision: SessionPersistenceRevision(`revision-${id}`),
  }
}

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const workspaceMap = new Map<string, Workspace>([
    ['00000000-0000-4000-8000-000000000011', referenceWorkspace('00000000-0000-4000-8000-000000000011', 'one')],
    ['00000000-0000-4000-8000-000000000012', referenceWorkspace('00000000-0000-4000-8000-000000000012', 'two')],
    ['00000000-0000-4000-8000-000000000013', referenceWorkspace('00000000-0000-4000-8000-000000000013', 'three')],
  ])
  const sessionMap = new Map<string, SessionPersistenceSnapshot>([
    ['session-one', sessionSnapshot('session-one')],
    ['session-two', sessionSnapshot('session-two')],
  ])
  const persistence = {
    stat: vi.fn(async (id: SessionId) => sessionMap.get(id)),
    list: vi.fn(async () => [...sessionMap.values()]),
    open: vi.fn(async () => { throw new Error('association links must not open a Session log') }),
  }
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => workspaceMap.get(id),
    list: () => [...workspaceMap.values()],
  } as never)
  ctx.provide('sessionPersistence', persistence as never)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityAssociationService)
  const activity = await ctx.homeActivities.create(request)
  return { ctx, pool, activity, workspaceMap, sessionMap, persistence }
}

async function activityOnly(pool: MemoryMediaPool): Promise<Context> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  return ctx
}

it('persists independent Workspace and DSH Session references across service restart', async () => {
  const pool = new MemoryMediaPool()
  const first = await harness(pool)
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  const firstSession = SessionId('session-one')
  const secondSession = SessionId('session-two')
  await expect(Promise.all([
    first.ctx.homeActivityAssociations.linkWorkspace(first.activity.id, firstWorkspace),
    first.ctx.homeActivityAssociations.linkWorkspace(first.activity.id, secondWorkspace),
    first.ctx.homeActivityAssociations.linkSession(first.activity.id, firstSession),
    first.ctx.homeActivityAssociations.linkSession(first.activity.id, secondSession),
  ])).resolves.toEqual([true, true, true, true])
  expect(first.persistence.open).not.toHaveBeenCalled()
  await first.ctx.fiber.dispose()

  const second = await harness(pool)
  expect(second.ctx.homeActivities.get(ActivityId(first.activity.id))).toEqual(first.activity)
  expect(second.ctx.homeActivityAssociations.get(first.activity.id)).toEqual({
    workspaceIds: [firstWorkspace, secondWorkspace],
    sessionIds: [firstSession, secondSession],
  })
  expect(second.persistence.open).not.toHaveBeenCalled()
})

it('keeps references idempotent, removes stale ids, and supports explicit correction', async () => {
  const test = await harness()
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  const correctedWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000013')
  const firstSession = SessionId('session-one')
  const secondSession = SessionId('session-two')
  const correctedSession = SessionId('session-three')
  await test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, firstWorkspace)
  await expect(test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, firstWorkspace)).resolves.toBe(false)
  await test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, secondWorkspace)
  await test.ctx.homeActivityAssociations.linkSession(test.activity.id, firstSession)
  await expect(test.ctx.homeActivityAssociations.linkSession(test.activity.id, firstSession)).resolves.toBe(false)
  await test.ctx.homeActivityAssociations.linkSession(test.activity.id, secondSession)
  test.sessionMap.set('session-three', sessionSnapshot('session-three'))
  test.workspaceMap.delete(firstWorkspace)
  test.sessionMap.delete(firstSession)
  expect(test.ctx.homeActivityAssociations.get(test.activity.id)).toMatchObject({
    workspaceIds: [firstWorkspace, secondWorkspace],
    sessionIds: [firstSession, secondSession],
  })
  await expect(test.ctx.homeActivityAssociations.unlinkWorkspace(test.activity.id, firstWorkspace)).resolves.toBe(true)
  await expect(test.ctx.homeActivityAssociations.unlinkWorkspace(test.activity.id, firstWorkspace)).resolves.toBe(false)
  await expect(test.ctx.homeActivityAssociations.unlinkSession(test.activity.id, firstSession)).resolves.toBe(true)
  await expect(test.ctx.homeActivityAssociations.unlinkSession(test.activity.id, firstSession)).resolves.toBe(false)
  await test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, correctedWorkspace)
  await test.ctx.homeActivityAssociations.linkSession(test.activity.id, correctedSession)
  expect(test.ctx.homeActivityAssociations.get(test.activity.id)).toEqual({
    workspaceIds: [secondWorkspace, correctedWorkspace],
    sessionIds: [secondSession, correctedSession],
  })
  expect(test.ctx.homeActivities.get(test.activity.id)).toEqual(test.activity)
  expect(test.persistence.open).not.toHaveBeenCalled()
})

it('rejects unknown Activity, Workspace, and Session identities without writing', async () => {
  const test = await harness()
  const unknownActivity = ActivityId('00000000-0000-4000-8000-000000000099')
  const unknownWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000099')
  const unknownSession = SessionId('session-missing')
  await expect(test.ctx.homeActivityAssociations.linkWorkspace(unknownActivity, unknownWorkspace))
    .rejects.toMatchObject({ code: 'unknown-activity' })
  await expect(test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, unknownWorkspace))
    .rejects.toMatchObject({ code: 'unknown-workspace' })
  await expect(test.ctx.homeActivityAssociations.linkSession(test.activity.id, unknownSession))
    .rejects.toMatchObject({ code: 'unknown-session' })
  expect(test.ctx.homeActivityAssociations.get(test.activity.id)).toEqual({ workspaceIds: [], sessionIds: [] })
  expect(Object.isFrozen(test.ctx.homeActivityAssociations.get(test.activity.id).workspaceIds)).toBe(true)
  expect(() => test.ctx.homeActivityAssociations.get(unknownActivity)).toThrow(/No saved Activity/u)
})

it('retains the prior durable associations when an association write fails', async () => {
  const pool = new MemoryMediaPool()
  const test = await harness(pool)
  const firstWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const secondWorkspace = WorkspaceId('00000000-0000-4000-8000-000000000012')
  await test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, firstWorkspace)
  pool.failNextWrites = 1
  await expect(test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, secondWorkspace))
    .rejects.toThrow('Home Activity association storage failed.')
  expect(test.ctx.homeActivityAssociations.get(test.activity.id)).toEqual({
    workspaceIds: [firstWorkspace],
    sessionIds: [],
  })
  await test.ctx.fiber.dispose()

  const reopened = await harness(pool)
  expect(reopened.ctx.homeActivityAssociations.get(test.activity.id)).toEqual({
    workspaceIds: [firstWorkspace],
    sessionIds: [],
  })
})

it('keeps the last reference when delete fails and reports reads before storage is ready', async () => {
  const pool = new MemoryMediaPool()
  const test = await harness(pool)
  const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000011')
  await test.ctx.homeActivityAssociations.linkWorkspace(test.activity.id, workspaceId)
  pool.failNextWrites = 1
  await expect(test.ctx.homeActivityAssociations.unlinkWorkspace(test.activity.id, workspaceId))
    .rejects.toBeInstanceOf(HomeActivityAssociationStorageError)
  expect(test.ctx.homeActivityAssociations.get(test.activity.id)).toEqual({
    workspaceIds: [workspaceId], sessionIds: [],
  })

  await expect(test.ctx.homeActivityAssociations.unlinkSession(test.activity.id, SessionId('not-linked')))
    .resolves.toBe(false)

  const unreadyContext = new Context()
  unreadyContext.provide('homeActivities', { get: () => test.activity } as never)
  const unready = new HomeActivityAssociationService(unreadyContext)
  expect(() => unready.get(test.activity.id)).toThrow(HomeActivityAssociationStorageError)
})

it('keeps the sidecar intact across an Activity-only application rollback', async () => {
  const pool = new MemoryMediaPool()
  const current = await harness(pool)
  const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000011')
  const sessionId = SessionId('session-one')
  await current.ctx.homeActivityAssociations.linkWorkspace(current.activity.id, workspaceId)
  await current.ctx.homeActivityAssociations.linkSession(current.activity.id, sessionId)
  const savedActivity = current.ctx.homeActivities.get(current.activity.id)
  await current.ctx.fiber.dispose()

  const rollback = await activityOnly(pool)
  expect(rollback.homeActivities.get(current.activity.id)).toEqual(savedActivity)
  expect(pool.media.has('home_activity_associations')).toBe(true)
  await rollback.fiber.dispose()

  const forward = await harness(pool)
  expect(forward.ctx.homeActivities.get(current.activity.id)).toEqual(savedActivity)
  expect(forward.ctx.homeActivityAssociations.get(current.activity.id)).toEqual({
    workspaceIds: [workspaceId],
    sessionIds: [sessionId],
  })
})
