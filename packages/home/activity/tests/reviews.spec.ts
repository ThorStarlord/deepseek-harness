import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityDelegationService, { activityDelegationId } from '../src/delegations.ts'
import HomeActivityReviewService, {
  ActivityReviewStorageError,
  MAX_HOME_ACTIVITY_REVIEW_EVIDENCE,
} from '../src/reviews.ts'
import type { CreateActivityRequest } from '../src/types.ts'

const contexts: Context[] = []
const request: CreateActivityRequest = {
  name: 'Release review',
  objective: 'Review a reported release change.',
  boundaries: { inScope: ['Inspect the report and evidence.'], outOfScope: ['Do not publish the release.'] },
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityDelegationService)
  await ctx.plugin(HomeActivityReviewService)
  return { ctx, pool }
}

async function createReportedDelegation(ctx: Context, activityId: ActivityId, sessionId: string) {
  const delegation = await ctx.homeActivityDelegations.createRequest({
    activityId,
    provider: 'spawn',
    task: 'Inspect the release report.',
    parentSessionId: SessionId(sessionId),
  })
  const admission = {
    childSessionId: SessionId(`child-${sessionId}`),
    activationName: `activity-${sessionId}`,
    admittedAt: '2026-11-18T12:00:00.000Z',
    source: 'subagents.startActivation' as const,
  }
  await ctx.homeActivityDelegations.recordAdmitted(delegation.id, admission)
  await ctx.homeActivityDelegations.recordReported(delegation.id, admission, {
    stopReason: 'stop',
    outputText: 'The provider reported the requested change complete.',
    nonTextBlockTypes: [],
    outputTruncated: false,
    reportedAt: '2026-11-18T12:01:00.000Z',
    source: 'subagent-activation-result',
  })
  return ctx.homeActivityDelegations.get(delegation.id)!
}

it('keeps a provider success report separate from failed user-supplied verification after restart', async () => {
  const pool = new MemoryMediaPool()
  const first = await harness(pool)
  const activity = await first.ctx.homeActivities.create(request)
  const delegation = await createReportedDelegation(first.ctx, activity.id, 'parent-one')

  expect(first.ctx.homeActivityReviews.get(activity.id, delegation.id)).toBeUndefined()
  const saved = await first.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'requires-investigation',
    evidence: {
      source: 'Release CI run',
      result: 'failed',
      summary: 'The publish validation job failed.',
      reference: 'https://example.test/checks/release-validation',
      observedAt: '2026-11-18T12:02:00.000Z',
    },
  })
  const additional = await first.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'requires-investigation',
    evidence: {
      source: 'Independent smoke check',
      result: 'passed',
      summary: 'The smoke check reported success.',
    },
  })
  expect(saved.disposition).toBe('requires-investigation')
  expect(saved.evidence).toMatchObject([{
    source: 'Release CI run', result: 'failed', origin: 'user-command',
  }])
  expect(saved.evidence[0]?.recordedAt).toEqual(expect.any(String))
  expect(additional.evidence).toMatchObject([
    { source: 'Release CI run', result: 'failed', origin: 'user-command' },
    { source: 'Independent smoke check', result: 'passed', origin: 'user-command' },
  ])
  expect(first.ctx.homeActivityDelegations.get(delegation.id)).toEqual(delegation)
  await first.ctx.fiber.dispose()

  const reopened = await harness(pool)
  expect(reopened.ctx.homeActivityReviews.get(activity.id, delegation.id)).toEqual(additional)
  expect(reopened.ctx.homeActivityDelegations.get(delegation.id)).toEqual(delegation)
})

it('keeps evidence when the user later changes the disposition and defaults to no acceptance', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(request)
  const delegation = await createReportedDelegation(test.ctx, activity.id, 'parent-two')

  const first = await test.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'pending',
    evidence: { source: 'Acceptance test', result: 'unavailable', summary: 'The test environment did not provide this check.' },
  })
  const accepted = await test.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'accepted',
  })
  const declined = await test.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'declined',
  })

  expect(first.disposition).toBe('pending')
  expect(accepted.disposition).toBe('accepted')
  expect(accepted.evidence).toEqual(first.evidence)
  expect(declined.disposition).toBe('declined')
  expect(declined.evidence).toEqual(first.evidence)
  expect(test.ctx.homeActivityDelegations.get(delegation.id)).toEqual(delegation)
})

it('rejects reviews for unknown or cross-Activity delegations', async () => {
  const test = await harness()
  const first = await test.ctx.homeActivities.create(request)
  const second = await test.ctx.homeActivities.create({ ...request, name: 'Other release' })
  const foreign = await test.ctx.homeActivityDelegations.createRequest({
    activityId: second.id,
    provider: 'spawn',
    task: 'Inspect another release.',
    parentSessionId: SessionId('foreign-parent'),
  })

  await expect(test.ctx.homeActivityReviews.record({
    activityId: first.id,
    delegationId: foreign.id,
    disposition: 'accepted',
  })).rejects.toMatchObject({ code: 'delegation-activity-mismatch' })
  await expect(test.ctx.homeActivityReviews.record({
    activityId: first.id,
    delegationId: activityDelegationId('00000000-0000-4000-8000-000000000099'),
    disposition: 'pending',
  })).rejects.toMatchObject({ code: 'unknown-delegation' })
  expect(test.ctx.homeActivityReviews.list(first.id)).toEqual([])
  expect(() => test.ctx.homeActivityReviews.list(ActivityId('00000000-0000-4000-8000-000000000098')))
    .toThrow(expect.objectContaining({ code: 'unknown-activity' }))
})

it('does not publish a review when the durable write fails', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(request)
  const delegation = await createReportedDelegation(test.ctx, activity.id, 'parent-three')
  const before = test.ctx.homeActivityDelegations.get(delegation.id)
  test.pool.failNextWrites = 1

  await expect(test.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'declined',
  })).rejects.toMatchObject({ name: 'ActivityReviewStorageError' })
  expect(test.ctx.homeActivityReviews.get(activity.id, delegation.id)).toBeUndefined()
  expect(test.ctx.homeActivityDelegations.get(delegation.id)).toEqual(before)
})

it('returns detached review snapshots', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(request)
  const delegation = await createReportedDelegation(test.ctx, activity.id, 'parent-four')
  const review = await test.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'declined',
    evidence: { source: 'Manual review', result: 'passed', summary: 'The requested result was reviewed.' },
  })
  const listed = test.ctx.homeActivityReviews.list(activity.id)

  expect(Object.isFrozen(review)).toBe(true)
  expect(Object.isFrozen(review.evidence)).toBe(true)
  expect(Object.isFrozen(review.evidence[0])).toBe(true)
  expect(Object.isFrozen(listed)).toBe(true)
})

it('keeps a pending empty review and sorts reviews by update time then stable delegation identity', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(request)
  const first = await createReportedDelegation(test.ctx, activity.id, 'parent-order-one')
  const second = await createReportedDelegation(test.ctx, activity.id, 'parent-order-two')
  const third = await createReportedDelegation(test.ctx, activity.id, 'parent-order-three')
  const foreignActivity = await test.ctx.homeActivities.create({ ...request, name: 'Other release' })
  const foreign = await createReportedDelegation(test.ctx, foreignActivity.id, 'parent-order-foreign')

  const pending = await test.ctx.homeActivityReviews.record({
    activityId: activity.id, delegationId: first.id, disposition: 'pending',
  })
  expect(pending.evidence).toEqual([])
  vi.setSystemTime(new Date('2026-11-18T12:01:00.000Z'))
  await test.ctx.homeActivityReviews.record({ activityId: activity.id, delegationId: second.id, disposition: 'declined' })
  await test.ctx.homeActivityReviews.record({ activityId: activity.id, delegationId: third.id, disposition: 'accepted' })
  await test.ctx.homeActivityReviews.record({ activityId: foreignActivity.id, delegationId: foreign.id, disposition: 'accepted' })

  const ordered = test.ctx.homeActivityReviews.list(activity.id).map(review => review.delegationId)
  expect(ordered).toEqual([second.id, third.id].sort((left, right) => String(left).localeCompare(String(right))).concat(first.id))
  expect(ordered).not.toContain(foreign.id)
})

it('rejects review reads before domain initialization with an explicit storage error', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(request)
  const delegation = await createReportedDelegation(test.ctx, activity.id, 'parent-cold-read')
  const coldContext = new Context()
  coldContext.provide('homeActivities', test.ctx.homeActivities)
  coldContext.provide('homeActivityDelegations', test.ctx.homeActivityDelegations)
  const coldService = new HomeActivityReviewService(coldContext)

  expect(() => coldService.get(activity.id, delegation.id)).toThrow(ActivityReviewStorageError)
  expect(() => coldService.list(activity.id)).toThrow(ActivityReviewStorageError)
})

it('caps evidence entries without preventing a disposition-only update', async () => {
  const test = await harness()
  const activity = await test.ctx.homeActivities.create(request)
  const delegation = await createReportedDelegation(test.ctx, activity.id, 'parent-evidence-limit')
  for (let index = 0; index < MAX_HOME_ACTIVITY_REVIEW_EVIDENCE; index += 1) {
    await test.ctx.homeActivityReviews.record({
      activityId: activity.id,
      delegationId: delegation.id,
      disposition: 'requires-investigation',
      evidence: { source: `Evidence ${index}`, result: 'inconclusive', summary: 'The check is unresolved.' },
    })
  }

  const updated = await test.ctx.homeActivityReviews.record({
    activityId: activity.id, delegationId: delegation.id, disposition: 'pending',
  })
  expect(updated.disposition).toBe('pending')
  expect(updated.evidence).toHaveLength(MAX_HOME_ACTIVITY_REVIEW_EVIDENCE)
  await expect(test.ctx.homeActivityReviews.record({
    activityId: activity.id,
    delegationId: delegation.id,
    disposition: 'accepted',
    evidence: { source: 'Additional check', result: 'passed', summary: 'This entry exceeds the evidence limit.' },
  })).rejects.toMatchObject({ code: 'evidence-limit' })
})
