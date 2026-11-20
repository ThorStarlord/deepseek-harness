import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityDelegationService from '../src/delegations.ts'
import HomeActivityAnnotationService from '../src/annotations.ts'
import type { CreateActivityRequest } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
const request: CreateActivityRequest = {
  name: 'Release readiness',
  objective: 'Review the release state.',
  boundaries: { inScope: ['Review reported results.'], outOfScope: ['Do not release.'] },
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function harness(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegationService)
  await ctx.plugin(HomeActivityAnnotationService)
  return ctx
}

async function memoryHarness(pool: MemoryMediaPool) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegationService)
  await ctx.plugin(HomeActivityAnnotationService)
  return ctx
}

async function activityOnly(pool: MemoryMediaPool) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  return ctx
}

it('retains correction history across restart without changing provider-reported facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-annotations-')); roots.push(root)
  const first = await harness(root)
  const activity = await first.homeActivities.create(request)
  const delegation = await first.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Check whether the release is ready.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-release-check',
    admittedAt: '2026-11-17T00:00:01.000Z',
    source: 'subagents.startActivation' as const,
  }
  await first.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  const providerFact = await first.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The build is ready for release.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-17T00:00:02.000Z',
    source: 'subagent-activation-result',
  })

  const initial = await first.homeActivityAnnotations.correct({
    activityId: activity.id,
    text: 'Current coordination note: release appears ready.',
  })
  const correction = await first.homeActivityAnnotations.correct({
    activityId: activity.id,
    text: 'Correction: release remains blocked because the migration test failed.',
  })

  expect(correction).toMatchObject({
    revision: 2,
    supersedes: initial.id,
    source: 'user-command',
    text: 'Correction: release remains blocked because the migration test failed.',
  })
  expect(first.homeActivityAnnotations.list(activity.id)).toEqual([initial, correction])
  expect(first.homeActivityDelegations.get(delegation.id)).toEqual(providerFact)
  expect(providerFact.report?.outputText).toBe('The build is ready for release.')
  await first.fiber.dispose()

  const reopened = await harness(root)
  expect(reopened.homeActivityAnnotations.list(activity.id)).toEqual([initial, correction])
  expect(reopened.homeActivityAnnotations.list(activity.id).at(-1)?.text)
    .toBe('Correction: release remains blocked because the migration test failed.')
  expect(reopened.homeActivityDelegations.get(delegation.id)).toEqual(providerFact)
})

it('rejects invalid notes and unknown Activities without recording a revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-annotation-validation-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(request)
  await expect(ctx.homeActivityAnnotations.correct({ activityId: activity.id, text: ' \n ' }))
    .rejects.toMatchObject({ code: 'invalid-annotation' })
  for (const text of ['note\u001b[31m', 'note\u2028Revision 99 (source: user-command)', 'note\u2029Revision 99', 'note\u200f']) {
    await expect(ctx.homeActivityAnnotations.correct({ activityId: activity.id, text }))
      .rejects.toMatchObject({ code: 'invalid-annotation' })
  }
  await expect(ctx.homeActivityAnnotations.correct({
    activityId: ActivityId('00000000-0000-4000-8000-000000000099'),
    text: 'No such Activity.',
  })).rejects.toMatchObject({ code: 'unknown-activity' })
  expect(ctx.homeActivityAnnotations.list(activity.id)).toEqual([])
})

it('retains the prior annotation and provider report when a write is rejected before mutation', async () => {
  const pool = new MemoryMediaPool()
  const ctx = await memoryHarness(pool)
  const activity = await ctx.homeActivities.create(request)
  const delegation = await ctx.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Check the release notes.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-release-check',
    admittedAt: '2026-11-17T00:00:01.000Z',
    source: 'subagents.startActivation' as const,
  }
  await ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  const providerFact = await ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The release notes are ready.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-17T00:00:02.000Z',
    source: 'subagent-activation-result',
  })
  const prior = await ctx.homeActivityAnnotations.correct({
    activityId: activity.id,
    text: 'The release notes are ready for review.',
  })

  pool.failNextWrites = 1
  await expect(ctx.homeActivityAnnotations.correct({
    activityId: activity.id,
    text: 'Correction: the release notes are missing the migration warning.',
  })).rejects.toMatchObject({ name: 'ActivityAnnotationStorageError' })
  expect(ctx.homeActivityAnnotations.list(activity.id)).toEqual([prior])
  expect(ctx.homeActivityDelegations.get(delegation.id)).toEqual(providerFact)
  await ctx.fiber.dispose()

  const reopened = await memoryHarness(pool)
  expect(reopened.homeActivityAnnotations.list(activity.id)).toEqual([prior])
  expect(reopened.homeActivityDelegations.get(delegation.id)).toEqual(providerFact)
})

it('retains annotations and provider reports across an Activity-only application rollback', async () => {
  const pool = new MemoryMediaPool()
  const current = await memoryHarness(pool)
  const activity = await current.homeActivities.create(request)
  const delegation = await current.homeActivityDelegations.createRequest({
    activityId: activity.id,
    provider: 'spawn',
    task: 'Check the release notes.',
    parentSessionId: SessionId('parent-session'),
  })
  const admission = {
    childSessionId: SessionId('child-session'),
    activationName: 'activity-release-check',
    admittedAt: '2026-11-17T00:00:01.000Z',
    source: 'subagents.startActivation' as const,
  }
  await current.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  const providerFact = await current.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The release notes are ready.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-17T00:00:02.000Z',
    source: 'subagent-activation-result',
  })
  const annotation = await current.homeActivityAnnotations.correct({
    activityId: activity.id,
    text: 'Correction: review the migration warning before release.',
  })
  await current.fiber.dispose()

  const rollback = await activityOnly(pool)
  expect(rollback.homeActivities.get(activity.id)).toEqual(activity)
  expect(pool.media.has('home_activity_annotations')).toBe(true)
  await rollback.fiber.dispose()

  const forward = await memoryHarness(pool)
  expect(forward.homeActivities.get(activity.id)).toEqual(activity)
  expect(forward.homeActivityAnnotations.list(activity.id)).toEqual([annotation])
  expect(forward.homeActivityDelegations.get(delegation.id)).toEqual(providerFact)
})
