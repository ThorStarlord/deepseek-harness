import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import HomeActivityService, { ActivityId as createActivityId } from '../src/index.ts'
import HomeActivityStrategicEpisodeService from '../src/strategic-episodes.ts'
import HomeActivityStrategicDeliberationService, {
  ActivityStrategicDeliberationError,
  ActivityStrategicDeliberationStorageError,
} from '../src/strategic-deliberations.ts'
import type { ActivityId } from '../src/types.ts'
import type { ActivityStrategicDeliberation } from '../src/strategic-deliberation-types.ts'
import type { ActivityStrategicDeliberationId } from '../src/strategic-deliberation-types.ts'
import type { ActivityStrategicEpisode } from '../src/strategic-episode-types.ts'
import type { RecordActivityStrategicDeliberationRequest } from '../src/strategic-deliberation-types.ts'
import {
  activityStrategicDeliberationConclusionSchema,
  activityStrategicDeliberationRecordSchema,
  recordActivityStrategicDeliberationRequestSchema,
} from '../src/strategic-deliberation-spec.ts'

const contexts: Context[] = []
const roots: string[] = []

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
  await ctx.plugin(HomeActivityStrategicEpisodeService)
  await ctx.plugin(HomeActivityStrategicDeliberationService)
  return ctx
}

function brief(activityId: ActivityId) {
  const revisionA = 'a'.repeat(40)
  const revisionB = 'b'.repeat(40)
  return {
    activityId,
    originSessionId: 'session-brief',
    requestId: '00000000-0000-4000-8000-000000000051',
    skillDigests: [
      { name: 'using-sensemaking', provider: 'fixture', digest: '1'.repeat(64) },
      { name: 'multi-repository-strategic-analysis', provider: 'fixture', digest: '2'.repeat(64) },
    ],
    requestedAt: '2026-11-23T10:00:00.000Z',
    status: 'complete' as const,
    repositories: [
      { workspaceId: '00000000-0000-4000-8000-000000000011', title: 'Harness', status: 'observed' as const, revision: revisionA, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-23T10:00:00.000Z', observedAtEnd: '2026-11-23T10:00:10.000Z' },
      { workspaceId: '00000000-0000-4000-8000-000000000012', title: 'Sensemaking', status: 'observed' as const, revision: revisionB, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-23T10:00:00.000Z', observedAtEnd: '2026-11-23T10:00:10.000Z' },
    ],
    evidence: [
      { id: 'E1', workspaceId: '00000000-0000-4000-8000-000000000011', revision: revisionA, path: 'README.md', note: 'The existing Activity brief is durable.' },
      { id: 'E2', workspaceId: '00000000-0000-4000-8000-000000000012', revision: revisionB, path: 'skills/using-sensemaking/SKILL.md', note: 'The Skill asks the active agent to select a warranted direction.' },
    ],
    findings: [{ kind: 'source-observation' as const, category: 'capability' as const, statement: 'A prior brief exists.', evidenceIds: ['E1', 'E2'] }],
    alternatives: [
      { name: 'Use the existing method', consequence: 'Avoid another controller.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
      { name: 'Build an adapter', consequence: 'Adds a retrieval seam.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
    ],
    uncertainties: [{ id: 'U1', statement: 'Repeated reentry may show a context gap.', evidenceIds: ['E1', 'E2'] }],
    recommendation: { disposition: 'INVESTIGATE' as const, responsibility: 'Try the existing Skill in one strategic assessment.', rationale: 'The source does not yet establish a retrieval gap.', scope: 'within-activity' as const, evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
  }
}

function reconsider(activityId: ActivityId, source: ActivityStrategicEpisode): RecordActivityStrategicDeliberationRequest {
  return {
    activityId,
    originSessionId: 'session-later',
    requestId: '00000000-0000-4000-8000-000000000052',
    sourceEpisodeId: source.id,
    sourceEpisodeRevision: source.revision,
    decisionQuestion: 'Is the existing Skill interface sufficient for the next use?',
    outcome: 'next-responsibility',
    disposition: 'adapt',
    proposedResponsibility: 'Run one explicit assessment using the existing Skills and record retrieval gaps.',
    scope: 'within-activity',
    rationale: 'The historical evidence supports a bounded use, while the unresolved uncertainty remains open.',
    evidenceUses: [
      { evidenceId: 'E1', treatment: 'supports', rationale: 'It shows the brief can be recovered.' },
      { evidenceId: 'E2', treatment: 'limits', rationale: 'It defines a method but does not establish runtime retrieval quality.' },
    ],
    uncertaintyReviews: [{ uncertaintyId: 'U1', treatment: 'remains-open', rationale: 'No newer source observation was made.' }],
    newUncertainties: [{ id: 'N1', statement: 'A real later Session may reveal missing context.', evidenceIds: ['E1'] }],
    skillDigests: [
      { name: 'using-sensemaking', provider: 'fixture', digest: '3'.repeat(64) },
      { name: 'strategic-repository-analysis', provider: 'fixture', digest: '4'.repeat(64) },
    ],
    requestedAt: '2026-11-23T10:02:00.000Z',
  }
}

it('appends source-linked deliberations and recovers them without rewriting historical briefs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-deliberation-')); roots.push(root)
  let ctx = await harness(root)
  const activity = await ctx.homeActivities.create({
    name: 'Strategic reentry', objective: 'Reconsider prior evidence in a later Session.',
    boundaries: { inScope: ['Produce advisory next-responsibility decisions.'], outOfScope: ['Do not implement automatically.'] },
  })
  const source = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))
  const request = reconsider(activity.id, source)
  const first = await ctx.homeActivityStrategicDeliberations.record(request)
  expect(first).toMatchObject({
    revision: 1,
    sourceEpisodeId: source.id,
    sourceEpisodeRevision: source.revision,
    sourceEpisodeRecordedAt: source.recordedAt,
    sourceEpisodeSessionId: source.originSessionId,
    originSessionId: 'session-later',
    producer: 'dsh-active-agent',
    outcome: 'next-responsibility',
    disposition: 'adapt',
  })
  expect(await ctx.homeActivityStrategicDeliberations.record(request)).toEqual(first)
  const followup = await ctx.homeActivityStrategicDeliberations.record({
    ...request,
    requestId: '00000000-0000-4000-8000-000000000053',
    outcome: 'insufficient-evidence',
    disposition: 'defer',
    proposedResponsibility: null,
    rationale: 'The old source observations are too stale to choose a current responsibility.',
    requestedAt: '2026-11-23T10:04:00.000Z',
  })
  expect(followup).toMatchObject({ revision: 2, supersedes: first.id, sourceEpisodeId: source.id, outcome: 'insufficient-evidence' })
  const rejectedRecommendation = await ctx.homeActivityStrategicDeliberations.record({
    ...request,
    requestId: '00000000-0000-4000-8000-000000000057',
    outcome: 'no-selection',
    disposition: 'reject',
    proposedResponsibility: null,
    rationale: 'The old recommendation does not answer the current decision question.',
    requestedAt: '2026-11-23T10:05:00.000Z',
  })
  expect(rejectedRecommendation).toMatchObject({ revision: 3, supersedes: followup.id, disposition: 'reject', outcome: 'no-selection' })
  const retainedRecommendation = await ctx.homeActivityStrategicDeliberations.record({
    ...request,
    requestId: '00000000-0000-4000-8000-000000000058',
    outcome: 'next-responsibility',
    disposition: 'retain',
    rationale: 'The bounded recommendation still answers the Activity question.',
    requestedAt: '2026-11-23T10:06:00.000Z',
  })
  expect(retainedRecommendation).toMatchObject({ revision: 4, supersedes: rejectedRecommendation.id, disposition: 'retain' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([source])
  await ctx.fiber.dispose()

  ctx = await harness(root)
  expect(ctx.homeActivityStrategicDeliberations.list(activity.id)).toEqual([
    first, followup, rejectedRecommendation, retainedRecommendation,
  ])
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([source])
})

it('rejects a missing exact source revision and evidence identifiers from another brief', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-deliberation-validation-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create({
    name: 'Strategic reentry', objective: 'Reconsider prior evidence in a later Session.',
    boundaries: { inScope: ['Produce advisory next-responsibility decisions.'], outOfScope: ['Do not implement automatically.'] },
  })
  const source = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source), sourceEpisodeRevision: 2,
  })).rejects.toMatchObject({ code: 'unknown-source-episode' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000054',
    evidenceUses: [{ evidenceId: 'E9', treatment: 'supports', rationale: 'Not present in this brief.' }],
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000055',
    outcome: 'next-responsibility',
    scope: 'outside-activity',
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000059',
    evidenceUses: [],
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000056',
    outcome: 'owner-decision',
    disposition: 'adapt',
    scope: 'within-activity',
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  expect(ctx.homeActivityStrategicDeliberations.list(activity.id)).toEqual([])
})

it('validates each strategic conclusion disposition and unique historical reference', () => {
  const conclusion = {
    decisionQuestion: 'Which bounded responsibility is warranted?',
    outcome: 'next-responsibility' as const,
    disposition: 'adapt' as const,
    proposedResponsibility: 'Use one saved brief in a later Session.',
    scope: 'within-activity' as const,
    rationale: 'The exact historical references support a bounded next step.',
    evidenceUses: [{ evidenceId: 'E1', treatment: 'supports' as const, rationale: 'The saved record is attributable.' }],
    uncertaintyReviews: [{ uncertaintyId: 'U1', treatment: 'remains-open' as const, rationale: 'No current source was checked.' }],
    newUncertainties: [{ id: 'N1', statement: 'Later use may reveal a context gap.', evidenceIds: ['E1'] }],
  }
  expect(activityStrategicDeliberationConclusionSchema.safeParse(conclusion).success).toBe(true)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...conclusion, scope: 'outside-activity' }).success).toBe(false)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...conclusion, proposedResponsibility: null }).success).toBe(false)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...conclusion, evidenceUses: [] }).success).toBe(false)

  const noSelection = { ...conclusion, outcome: 'no-selection' as const, disposition: 'no-selection' as const, proposedResponsibility: null }
  expect(activityStrategicDeliberationConclusionSchema.safeParse(noSelection).success).toBe(true)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...noSelection, proposedResponsibility: 'Must not be selected.' }).success).toBe(false)

  const ownerDecision = { ...noSelection, outcome: 'owner-decision' as const, disposition: 'escalate' as const, scope: 'owner-decision' as const }
  expect(activityStrategicDeliberationConclusionSchema.safeParse(ownerDecision).success).toBe(true)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...ownerDecision, disposition: 'defer' }).success).toBe(false)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...ownerDecision, scope: 'within-activity' }).success).toBe(false)

  const thesisReview = { ...ownerDecision, outcome: 'thesis-review' as const }
  expect(activityStrategicDeliberationConclusionSchema.safeParse(thesisReview).success).toBe(true)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...thesisReview, scope: 'within-activity' }).success).toBe(false)

  const insufficient = { ...noSelection, outcome: 'insufficient-evidence' as const, disposition: 'defer' as const }
  expect(activityStrategicDeliberationConclusionSchema.safeParse(insufficient).success).toBe(true)
  expect(activityStrategicDeliberationConclusionSchema.safeParse({ ...insufficient, proposedResponsibility: 'Not enough evidence.' }).success).toBe(false)
  const duplicateEvidenceUses = [conclusion.evidenceUses[0]!, conclusion.evidenceUses[0]!]
  const duplicateUncertaintyReviews = [conclusion.uncertaintyReviews[0]!, conclusion.uncertaintyReviews[0]!]
  const duplicateNewUncertainties = [conclusion.newUncertainties[0]!, conclusion.newUncertainties[0]!]
  const duplicateEvidenceResult = activityStrategicDeliberationConclusionSchema.safeParse({
    ...conclusion, evidenceUses: duplicateEvidenceUses,
  })
  const duplicatePriorUncertaintyResult = activityStrategicDeliberationConclusionSchema.safeParse({
    ...conclusion, uncertaintyReviews: duplicateUncertaintyReviews,
  })
  const duplicateNewUncertaintyResult = activityStrategicDeliberationConclusionSchema.safeParse({
    ...conclusion, newUncertainties: duplicateNewUncertainties,
  })
  expect(duplicateEvidenceResult.success).toBe(false)
  expect(duplicatePriorUncertaintyResult.success).toBe(false)
  expect(duplicateNewUncertaintyResult.success).toBe(false)

  const common = {
    ...insufficient,
    activityId: '00000000-0000-4000-8000-000000000011',
    originSessionId: 'later-session',
    requestId: '00000000-0000-4000-8000-000000000052',
    sourceEpisodeId: '00000000-0000-4000-8000-000000000053',
    sourceEpisodeRevision: 1,
    skillDigests: [{ name: 'using-sensemaking', provider: 'fixture', digest: 'a'.repeat(64) }],
    requestedAt: '2026-11-23T10:00:00.000Z',
  }
  expect(recordActivityStrategicDeliberationRequestSchema.safeParse(common).success).toBe(true)
  expect(recordActivityStrategicDeliberationRequestSchema.safeParse({ ...common, disposition: 'retain' }).success).toBe(false)
  expect(recordActivityStrategicDeliberationRequestSchema.safeParse({ ...common, disposition: 'no-selection' }).success).toBe(true)

  const durable = {
    ...common,
    id: '00000000-0000-4000-8000-000000000054',
    revision: 1,
    producer: 'dsh-active-agent' as const,
    sourceEpisodeRecordedAt: '2026-11-23T09:00:00.000Z',
    sourceEpisodeSessionId: 'source-session',
    status: 'complete' as const,
    recordedAt: '2026-11-23T10:00:01.000Z',
  }
  expect(activityStrategicDeliberationRecordSchema.safeParse(durable).success).toBe(true)
  expect(activityStrategicDeliberationRecordSchema.safeParse({ ...durable, disposition: 'retain' }).success).toBe(false)
  expect(activityStrategicDeliberationRecordSchema.safeParse({ ...durable, disposition: 'no-selection' }).success).toBe(true)
})

it('preserves storage failure ownership and sorts same-revision rows by stable identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-deliberation-storage-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create({
    name: 'Storage failures', objective: 'Keep advisory history readable after errors.',
    boundaries: { inScope: ['Read durable decisions.'], outOfScope: ['Do not start work.'] },
  })
  const source = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))
  const request = reconsider(activity.id, source)
  const saved = await ctx.homeActivityStrategicDeliberations.record(request)
  const unknownActivity = createActivityId('00000000-0000-4000-8000-000000000099')
  expect(() => ctx.homeActivityStrategicDeliberations.list(unknownActivity))
    .toThrowError('No saved Activity has id')
  await expect(ctx.homeActivityStrategicDeliberations.record({ ...request, activityId: unknownActivity }))
    .rejects.toMatchObject({ code: 'unknown-activity' })

  const firstId = '00000000-0000-4000-8000-000000000071'
  const secondId = '00000000-0000-4000-8000-000000000072'
  const first = { ...saved, id: firstId as ActivityStrategicDeliberationId }
  const second = { ...saved, id: secondId as ActivityStrategicDeliberationId }
  Object.assign(ctx.homeActivityStrategicDeliberations, {
    table: { entries: () => [[secondId, second], [firstId, first]], put: async () => {} },
  })
  expect(ctx.homeActivityStrategicDeliberations.list(activity.id).map(item => item.id)).toEqual([firstId, secondId])

  Object.assign(ctx.homeActivityStrategicDeliberations, {
    table: { entries: () => { throw new Error('read failed') }, put: async () => {} },
  })
  expect(() => ctx.homeActivityStrategicDeliberations.list(activity.id)).toThrowError(ActivityStrategicDeliberationStorageError)
  Object.assign(ctx.homeActivityStrategicDeliberations, {
    table: { entries: () => { throw new ActivityStrategicDeliberationError('invalid-deliberation', 'already classified') }, put: async () => {} },
  })
  expect(() => ctx.homeActivityStrategicDeliberations.list(activity.id)).toThrowError('already classified')
  Object.assign(ctx.homeActivityStrategicDeliberations, { table: undefined })
  expect(() => ctx.homeActivityStrategicDeliberations.list(activity.id)).toThrowError(ActivityStrategicDeliberationStorageError)
})

it('contains write failures, invalid durable attribution, oversized rows, and the append limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-deliberation-limits-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create({
    name: 'Record limits', objective: 'Keep unconfirmed deliberation writes visible.',
    boundaries: { inScope: ['Record bounded decisions.'], outOfScope: ['Do not retry unknown writes.'] },
  })
  const source = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))

  Object.assign(ctx.homeActivityStrategicDeliberations, {
    table: { entries: () => [], put: async () => { throw new Error('write failed') } },
  })
  await expect(ctx.homeActivityStrategicDeliberations.record(reconsider(activity.id, source)))
    .rejects.toBeInstanceOf(ActivityStrategicDeliberationStorageError)

  Object.assign(ctx.homeActivityStrategicDeliberations, {
    table: { entries: () => [], put: async () => {} },
  })
  vi.spyOn(ctx.homeActivityStrategicEpisodes, 'list').mockReturnValue([{ ...source, recordedAt: 'not-a-timestamp' }])
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source), requestId: '00000000-0000-4000-8000-000000000073',
  })).rejects.toMatchObject({ code: 'invalid-deliberation' })
  vi.restoreAllMocks()

  const oversized = {
    ...reconsider(activity.id, source),
    requestId: '00000000-0000-4000-8000-000000000074',
    newUncertainties: Array.from({ length: 64 }, (_, index) => ({
      id: `N${index + 1}`,
      statement: 'x'.repeat(4_000),
      evidenceIds: [],
    })),
  }
  await expect(ctx.homeActivityStrategicDeliberations.record(oversized))
    .rejects.toMatchObject({ code: 'invalid-deliberation', message: expect.stringContaining('64 KiB storage limit') })

  const accepted = await ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source), requestId: '00000000-0000-4000-8000-000000000075',
  })
  const fullHistory: ActivityStrategicDeliberation[] = Array.from({ length: 128 }, (_, index) => ({
    ...accepted,
    revision: index + 1,
    requestId: `00000000-0000-4000-8000-${String(index + 76).padStart(12, '0')}`,
  }))
  vi.spyOn(ctx.homeActivityStrategicDeliberations, 'list').mockReturnValue(fullHistory)
  await expect(ctx.homeActivityStrategicDeliberations.record({
    ...reconsider(activity.id, source), requestId: '00000000-0000-4000-8000-000000000300',
  })).rejects.toMatchObject({ code: 'deliberation-limit' })
})
