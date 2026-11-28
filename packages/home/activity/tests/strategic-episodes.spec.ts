import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import HomeActivityService, { ActivityId } from '../src/index.ts'
import HomeActivityStrategicEpisodeService, {
  ActivityStrategicEpisodeError,
  ActivityStrategicEpisodeStorageError,
  MAX_HOME_ACTIVITY_STRATEGIC_EPISODE_BYTES,
  MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY,
} from '../src/strategic-episodes.ts'
import type {
  ActivityStrategicAlternative,
  ActivityStrategicEvidenceReference,
  ActivityStrategicEpisode,
  ActivityStrategicEpisodeId,
  ActivityStrategicFinding,
  ActivityStrategicRepositoryObservation,
  ActivityStrategicUncertainty,
  RecordActivityStrategicEpisodeRequest,
} from '../src/strategic-episode-types.ts'
import {
  activityStrategicEpisodeRecordSchema,
  recordActivityStrategicEpisodeRequestSchema,
} from '../src/strategic-episode-spec.ts'
import type { ActivityId as ActivityIdType } from '../src/types.ts'
import type { CreateActivityRequest } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
const activityRequest: CreateActivityRequest = {
  name: 'Sensemaking integration',
  objective: 'Improve the practical integration of Sensemaking capabilities into DeepSeek Harness development workflows.',
  boundaries: { inScope: ['Assess DSH and Sensemaking source.'], outOfScope: ['Do not start implementation.'] },
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
  await ctx.plugin(HomeActivityStrategicEpisodeService)
  return ctx
}

async function memoryHarness(pool = new MemoryMediaPool()) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(HomeActivityService)
  await ctx.plugin(HomeActivityStrategicEpisodeService)
  return { ctx, pool }
}

async function failingReadHarness() {
  const ctx = new Context(); contexts.push(ctx)
  ctx.provide('storageDomain', {
    open: async () => ({
      close: async () => {},
      table: () => ({ entries: () => { throw new Error('injected read failure') } }),
    }),
  } as never)
  ctx.provide('homeActivities', { get: () => ({ objective: activityRequest.objective }) } as never)
  await ctx.plugin(HomeActivityStrategicEpisodeService)
  return ctx
}

type StrategicEpisodeBrief = Omit<
  RecordActivityStrategicEpisodeRequest,
  'repositories' | 'skillDigests' | 'evidence' | 'findings' | 'alternatives' | 'uncertainties'
> & {
  readonly repositories: readonly [
    ActivityStrategicRepositoryObservation,
    ActivityStrategicRepositoryObservation,
  ]
  readonly skillDigests: readonly [
    ActivityStrategicEpisode['skillDigests'][0],
    ActivityStrategicEpisode['skillDigests'][0],
  ]
  readonly evidence: readonly [
    ActivityStrategicEvidenceReference,
    ActivityStrategicEvidenceReference,
  ]
  readonly findings: readonly [ActivityStrategicFinding]
  readonly alternatives: readonly [
    ActivityStrategicAlternative,
    ActivityStrategicAlternative,
  ]
  readonly uncertainties: readonly [ActivityStrategicUncertainty]
}

function brief(activityId: ActivityIdType): StrategicEpisodeBrief {
  const firstRevision = 'a'.repeat(40)
  const secondRevision = 'b'.repeat(40)
  return {
    activityId,
    originSessionId: 'session-first',
    requestId: '00000000-0000-4000-8000-000000000021',
    skillDigests: [
      { name: 'using-sensemaking' as const, provider: 'filesystem', digest: '1'.repeat(64) },
      { name: 'multi-repository-strategic-analysis' as const, provider: 'filesystem', digest: '2'.repeat(64) },
    ],
    status: 'complete' as const,
    repositories: [
      { workspaceId: '00000000-0000-4000-8000-000000000011', title: 'Harness', status: 'observed' as const, revision: firstRevision, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-22T10:00:00.000Z', observedAtEnd: '2026-11-22T10:00:10.000Z' },
      { workspaceId: '00000000-0000-4000-8000-000000000012', title: 'Sensemaking', status: 'observed' as const, revision: secondRevision, workingTree: 'clean' as const, sourceChanged: false, observedAtStart: '2026-11-22T10:00:00.000Z', observedAtEnd: '2026-11-22T10:00:10.000Z' },
    ] as const,
    evidence: [
      { id: 'E1', workspaceId: '00000000-0000-4000-8000-000000000011', revision: firstRevision, path: 'packages/home/activity/README.md', lineStart: 12, note: 'Activity records are separate from Session lifecycle.' },
      { id: 'E2', workspaceId: '00000000-0000-4000-8000-000000000012', revision: secondRevision, path: 'skills/multi-repository-strategic-analysis/SKILL.md', lineStart: 20, note: 'Analysis remains advisory.' },
    ] as const,
    findings: [
      { kind: 'source-observation' as const, category: 'capability' as const, statement: 'DSH supports durable Activity records.', evidenceIds: ['E1'] },
    ],
    alternatives: [
      { name: 'Reuse existing Skill invocation', consequence: 'Avoid a second strategic controller.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
      { name: 'Add a native adapter', consequence: 'Could improve direct retrieval but would add another integration surface.', evidenceIds: ['E1', 'E2'], uncertaintyIds: ['U1'] },
    ],
    uncertainties: [{ id: 'U1', statement: 'The selected DSH profile may not load the Sensemaking Skills.', evidenceIds: ['E2'] }],
    recommendation: {
      disposition: 'INVESTIGATE' as const,
      responsibility: 'Qualify the Skill-based assessment path.',
      rationale: 'Verify the existing Skill and repository-read interfaces before adding an adapter.',
      scope: 'within-activity' as const,
      evidenceIds: ['E1', 'E2'],
      uncertaintyIds: ['U1'],
    },
    requestedAt: '2026-11-22T09:59:00.000Z',
  }
}

function requestContent(value: RecordActivityStrategicEpisodeRequest) {
  const { status, repositories, evidence, findings, alternatives, uncertainties, recommendation } = value
  return { status, repositories, evidence, findings, alternatives, uncertainties, recommendation }
}

function arrayItem<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`Expected array item at index ${index}`)
  return item
}

it('retains source-attributed episodes across restart and never rewrites earlier recommendations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-episodes-')); roots.push(root)
  const first = await harness(root)
  const activity = await first.homeActivities.create(activityRequest)
  const initial = await first.homeActivityStrategicEpisodes.record(brief(activity.id))
  expect(await first.homeActivityStrategicEpisodes.record(brief(activity.id))).toEqual(initial)
  const later = await first.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    originSessionId: 'session-second',
    requestId: '00000000-0000-4000-8000-000000000022',
    repositories: [
      { ...brief(activity.id).repositories[0], revision: 'c'.repeat(40) },
      brief(activity.id).repositories[1],
    ],
    evidence: [
      { ...brief(activity.id).evidence[0], revision: 'c'.repeat(40) },
      brief(activity.id).evidence[1],
    ],
    recommendation: {
      disposition: 'NO_CHANGE',
      responsibility: null,
      rationale: 'The available sources do not establish a need for additional infrastructure.',
      scope: 'within-activity',
      evidenceIds: ['E1', 'E2'],
      uncertaintyIds: ['U1'],
    },
  })
  expect(later).toMatchObject({ revision: 2, supersedes: initial.id, originSessionId: 'session-second' })
  expect(first.homeActivityStrategicEpisodes.list(activity.id)).toEqual([initial, later])
  expect(initial.repositories[0]?.revision).toBe('a'.repeat(40))
  expect(initial.recommendation.disposition).toBe('INVESTIGATE')
  await first.fiber.dispose()

  const reopened = await harness(root)
  expect(reopened.homeActivities.get(activity.id)?.objective).toBe(activityRequest.objective)
  expect(reopened.homeActivityStrategicEpisodes.list(activity.id)).toEqual([initial, later])
  expect(reopened.homeActivityStrategicEpisodes.list(activity.id)[0]?.repositories[0]?.revision).toBe('a'.repeat(40))
  expect(reopened.homeActivityStrategicEpisodes.list(activity.id)[1]?.repositories[0]?.revision).toBe('c'.repeat(40))
})

it('rejects uncited paths, mismatched source revisions, and unknown Activities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-validation-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)

  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    evidence: [{ ...brief(activity.id).evidence[0], path: '../private.txt' }, brief(activity.id).evidence[1]],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    repositories: [
      { ...brief(activity.id).repositories[0], revision: 'c'.repeat(40) },
      brief(activity.id).repositories[1],
    ],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    activityId: ActivityId('00000000-0000-4000-8000-000000000099'),
  })).rejects.toMatchObject({ code: 'unknown-activity' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000024',
    repositories: [
      { ...brief(activity.id).repositories[0], workingTree: 'dirty' },
      brief(activity.id).repositories[1],
    ],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000025',
    repositories: [
      { ...brief(activity.id).repositories[0], sourceChanged: true },
      brief(activity.id).repositories[1],
    ],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([])
})

it('requires an unavailable repository to remain explicitly incomplete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-incomplete-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)
  const unavailable = {
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000023',
    repositories: [
      {
        ...brief(activity.id).repositories[0],
        status: 'unavailable' as const,
        revision: null,
        workingTree: 'unknown' as const,
        sourceChanged: null,
        observedAtStart: null,
        observedAtEnd: null,
      },
      brief(activity.id).repositories[1],
    ] as const,
  }
  await expect(ctx.homeActivityStrategicEpisodes.record(unavailable)).rejects.toMatchObject({ code: 'invalid-episode' })
  const incomplete = await ctx.homeActivityStrategicEpisodes.record({
    ...unavailable,
    status: 'incomplete',
    evidence: [brief(activity.id).evidence[1]],
    findings: [{ kind: 'source-observation', category: 'constraint', statement: 'One selected Workspace was unavailable.', evidenceIds: ['E2'] }],
    alternatives: [{ name: 'Wait for access', consequence: 'Gather both sources before selecting work.', evidenceIds: ['E2'], uncertaintyIds: ['U1'] }],
    uncertainties: [{ id: 'U1', statement: 'The unavailable repository may change the assessment.', evidenceIds: ['E2'] }],
    recommendation: {
      disposition: 'NO_CHANGE',
      responsibility: null,
      rationale: 'The missing repository prevents a complete decision.',
      scope: 'within-activity',
      evidenceIds: ['E2'],
      uncertaintyIds: ['U1'],
    },
  })
  expect(incomplete.status).toBe('incomplete')
})

it('validates source observation order, source paths, recommendations, and repository identity', () => {
  const valid = brief(ActivityId('00000000-0000-4000-8000-000000000099'))
  const firstRepository = valid.repositories[0]
  const secondRepository = valid.repositories[1]
  const firstEvidence = valid.evidence[0]
  const invalidRequests = [
    { ...valid, repositories: [{ ...firstRepository, revision: null }, secondRepository] },
    { ...valid, repositories: [{ ...firstRepository, observedAtStart: null }, secondRepository] },
    { ...valid, repositories: [{ ...firstRepository, observedAtStart: '2026-11-22T10:00:10.000Z', observedAtEnd: '2026-11-22T10:00:09.000Z' }, secondRepository] },
    { ...valid, repositories: [firstRepository, { ...secondRepository, workspaceId: firstRepository.workspaceId }] },
    { ...valid, evidence: [{ ...firstEvidence, path: 'packages/../secrets.txt' }, valid.evidence[1]] },
    { ...valid, evidence: [{ ...firstEvidence, lineStart: 12, lineEnd: 11 }, valid.evidence[1]] },
    { ...valid, recommendation: { ...valid.recommendation, disposition: 'NO_CHANGE' as const, responsibility: 'Continue implementation.' } },
    { ...valid, recommendation: { ...valid.recommendation, disposition: 'DEFER' as const, responsibility: null } },
  ]

  for (const invalid of invalidRequests) {
    expect(recordActivityStrategicEpisodeRequestSchema.safeParse(requestContent(invalid)).success).toBe(false)
  }

  const unavailable = {
    ...firstRepository,
    status: 'unavailable' as const,
    revision: null,
    workingTree: 'unknown' as const,
    sourceChanged: null,
    observedAtStart: null,
    observedAtEnd: null,
  }
  for (const invalidRepository of [
    { ...unavailable, revision: firstRepository.revision },
    { ...unavailable, workingTree: 'clean' as const },
    { ...unavailable, sourceChanged: false },
  ]) {
    expect(recordActivityStrategicEpisodeRequestSchema.safeParse(requestContent({
      ...valid,
      repositories: [invalidRepository, secondRepository],
    })).success).toBe(false)
  }
  expect(recordActivityStrategicEpisodeRequestSchema.safeParse(requestContent({
    ...valid,
    status: 'incomplete',
    repositories: [{ ...firstRepository, workingTree: 'dirty' as const, sourceChanged: true }, secondRepository],
  })).success).toBe(true)
})

it('rejects repeated or unresolved strategic evidence references in both request and stored records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-home-activity-strategic-references-')); roots.push(root)
  const ctx = await harness(root)
  const activity = await ctx.homeActivities.create(activityRequest)
  const valid = brief(activity.id)
  const duplicateEvidence = { ...valid, evidence: [valid.evidence[0], { ...valid.evidence[1], id: valid.evidence[0].id }] }
  const duplicateUncertainty = { ...valid, uncertainties: [valid.uncertainties[0], { ...valid.uncertainties[0] }] }
  const missingEvidence = { ...valid, findings: [{ ...valid.findings[0], evidenceIds: ['E9'] }] }
  const missingUncertainty = { ...valid, recommendation: { ...valid.recommendation, uncertaintyIds: ['U9'] } }
  const incompleteComplete = {
    ...valid,
    evidence: [],
    findings: [],
    alternatives: [],
    uncertainties: [],
    recommendation: { ...valid.recommendation, evidenceIds: [], uncertaintyIds: [] },
  }

  for (const invalid of [duplicateEvidence, duplicateUncertainty, missingEvidence, missingUncertainty, incompleteComplete]) {
    expect(recordActivityStrategicEpisodeRequestSchema.safeParse(requestContent(invalid)).success).toBe(false)
  }

  const episode = await ctx.homeActivityStrategicEpisodes.record(valid)
  const firstRepository = arrayItem(episode.repositories, 0)
  const secondRepository = arrayItem(episode.repositories, 1)
  const firstSkillDigest = arrayItem(episode.skillDigests, 0)
  const firstEvidence = arrayItem(episode.evidence, 0)
  const firstUncertainty = arrayItem(episode.uncertainties, 0)
  const firstFinding = arrayItem(episode.findings, 0)
  const storedInvalid = [
    {
      ...episode,
      repositories: [firstRepository, { ...secondRepository, workspaceId: firstRepository.workspaceId }],
    },
    { ...episode, skillDigests: [firstSkillDigest, firstSkillDigest] },
    { ...episode, evidence: [firstEvidence, firstEvidence] },
    { ...episode, uncertainties: [firstUncertainty, firstUncertainty] },
    { ...episode, findings: [{ ...firstFinding, evidenceIds: ['E9'] }] },
    { ...episode, recommendation: { ...episode.recommendation, uncertaintyIds: ['U9'] } },
  ]
  for (const invalid of storedInvalid) {
    expect(activityStrategicEpisodeRecordSchema.safeParse(invalid).success).toBe(false)
  }
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...valid,
    requestId: '00000000-0000-4000-8000-000000000026',
    skillDigests: [valid.skillDigests[0], valid.skillDigests[0]],
  })).rejects.toMatchObject({ code: 'invalid-episode' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([episode])
})

it('rejects oversized episodes and preserves the per-Activity history limit', async () => {
  const { ctx } = await memoryHarness()
  const activity = await ctx.homeActivities.create(activityRequest)
  const valid = brief(activity.id)
  const oversized = {
    ...valid,
    findings: Array.from({ length: Math.ceil(MAX_HOME_ACTIVITY_STRATEGIC_EPISODE_BYTES / 4_000) }, () => ({
      ...valid.findings[0],
      statement: 'x'.repeat(4_000),
    })),
  }
  await expect(ctx.homeActivityStrategicEpisodes.record(oversized))
    .rejects.toMatchObject({ code: 'invalid-episode' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([])

  for (let index = 1; index <= MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY; index += 1) {
    const suffix = index.toString(16).padStart(12, '0')
    await ctx.homeActivityStrategicEpisodes.record({
      ...valid,
      requestId: `00000000-0000-4000-8000-${suffix}`,
      status: 'incomplete',
    })
  }
  await expect(ctx.homeActivityStrategicEpisodes.record({
    ...valid,
    requestId: '00000000-0000-4000-8000-0000000000ff',
  })).rejects.toMatchObject({ code: 'episode-limit' })
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toHaveLength(MAX_HOME_ACTIVITY_STRATEGIC_EPISODES_PER_ACTIVITY)
  expect(() => ctx.homeActivityStrategicEpisodes.list(ActivityId('00000000-0000-4000-8000-000000000099')))
    .toThrow(ActivityStrategicEpisodeError)
})

it('reports write failures without claiming a brief was saved', async () => {
  const { ctx, pool } = await memoryHarness()
  const activity = await ctx.homeActivities.create(activityRequest)
  const request = { ...brief(activity.id), requestId: '00000000-0000-4000-8000-000000000027' }
  pool.failNextWrites = 1
  await expect(ctx.homeActivityStrategicEpisodes.record(request))
    .rejects.toBeInstanceOf(ActivityStrategicEpisodeStorageError)
  expect(ctx.homeActivityStrategicEpisodes.list(activity.id)).toEqual([])
  await expect(ctx.homeActivityStrategicEpisodes.record(request)).resolves.toMatchObject({ revision: 1 })
})

it('wraps a failed history read without inventing an empty history', async () => {
  const ctx = await failingReadHarness()
  expect(() => ctx.homeActivityStrategicEpisodes.list(ActivityId('00000000-0000-4000-8000-000000000099')))
    .toThrow(ActivityStrategicEpisodeStorageError)
})

it('orders duplicate persisted revisions by stable identity and reports an uninitialized store', async () => {
  const { ctx } = await memoryHarness()
  const activity = await ctx.homeActivities.create(activityRequest)
  const first = await ctx.homeActivityStrategicEpisodes.record(brief(activity.id))
  const second = await ctx.homeActivityStrategicEpisodes.record({
    ...brief(activity.id),
    requestId: '00000000-0000-4000-8000-000000000028',
  })
  const table = Reflect.get(ctx.homeActivityStrategicEpisodes, 'table') as KvTable<ActivityStrategicEpisodeId, ActivityStrategicEpisode>
  await table.put(second.id, { ...second, revision: first.revision })

  expect(ctx.homeActivityStrategicEpisodes.list(activity.id).map(episode => episode.id)).toEqual(
    [first.id, second.id].sort((left, right) => String(left).localeCompare(String(right))),
  )

  const unreadyContext = new Context()
  contexts.push(unreadyContext)
  unreadyContext.provide('homeActivities', { get: () => activity } as never)
  const unready = new HomeActivityStrategicEpisodeService(unreadyContext)
  expect(() => unready.list(activity.id)).toThrow(ActivityStrategicEpisodeStorageError)
})
